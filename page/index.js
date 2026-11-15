/**
 * Таймеры занятий (6 штук, 2×3), очередь занятий сверху, цветные таймеры, экран настройки ценности 🩸 и экран подарков 🎁.
 * Подробности логики — в shared/core.js.
 *  - Нажатие на эмодзи: запуск (эмодзи заменяется цифрами: минуты до конца промежутка). Нажатие на цифры — СТОП:
 *    таймер обнуляется, на телефон уходит пройденное время. Запуск другого таймера останавливает прежний.
 *  - Промежуток = ценность 🩸 (60 / 45 / 30 минут, меняется на экране настройки). В конце — вибрация, событие
 *    уходит на телефон (app-side/index.js), таймер продолжается.
 *  - Экран делится на три равные строки: очередь (первые шесть значков) / 🤿 🎨 🩸 / 📖 🧬 💀.
 *  - Долгое нажатие на нижний ряд (🧬 💀) — красный таймер 15 минут; на верхний ряд (🤿 🎨 🩸) — зелёный 60 минут
 *    (по окончании и при досрочном выходе телефон превращает один 🎁 в ❤️);
 *    на очередь — серый таймер длиной в ценность 🩸 (по окончании телефон убирает 🏠🍀🔍 из очереди, как при нажатии
 *    на очередь в виджете). Цветной таймер — на весь экран, обычный тап ничего не делает, досрочный выход — долгое нажатие.
 *    По окончании цветной таймер сам закрывается (вибрация — та же, что в конце занятия), приложение остаётся открытым.
 *  - Долгое нажатие на 📖 — тестовый режим (все промежутки и цветные таймеры по 10 секунд, всё засчитывается по-настоящему).
 *  - Свайп вниз — экран подарков: сверху ❤️ (до двух строк по восемь), по центру большой 🎁 и под ним «x N»;
 *    при N = 0 сам 🎁 не показывается. Свайп в любую другую сторону — экран настройки ценности 🩸: нажатие на 🩸 —
 *    60 → 45 → 30. Закрыть любой из них — свайп или долгое нажатие. Открываются только когда ничего не идёт.
 *  - Очередь и подарки приходят с телефона (при запуске приложения, раз в минуту и в ответ на каждое событие).
 */
import { BasePage } from '@zeppos/zml/base-page'
import { createWidget, widget, prop, align, text_style } from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { Vibrator, VIBRATOR_SCENE_DURATION_LONG } from '@zos/sensor'
import { setPageBrightTime, pauseDropWristScreenOff, setWakeUpRelaunch } from '@zos/display'
import { LocalStorage } from '@zos/storage'
import * as inter from '@zos/interaction'
import { set as alarmSet, cancel as alarmCancel } from '@zos/alarm'
import * as core from '../shared/core'

const SEND_GAP = 15000        // как часто повторять отправку неподтверждённого события
const USE_ALARM = true        // будить приложение будильником, когда промежуток заканчивается при погасшем экране
const KEEP_AWAKE = true       // пока что-то идёт, не гасить экран
// Поля экрана (в координатах 432 px по ширине). Если что-то обрезано — меняйте эти числа.
const SCREEN_W = 432
const LEFT = 8                // отступ слева
const QSZ = 60                // размер значка очереди
const QSTEP = 64              // шаг значков очереди (6 штук = 380 px, как ширина сетки)
const QMAX = 6                // сколько значков очереди помещается (остальные на часах не показываются)
const CELL = 120
const GAP = 10
// Горизонтальный центр видимой области: середина сетки (LEFT + 380/2). Цветные таймеры и экран подарков центруются по нему.
// Если время или сердечки «съезжают» вправо/влево — меняйте это число.
const CX = 198
const OV_W = CX * 2           // ширина части цветного экрана с цифрами (остаток справа — полоса того же цвета)
// Экран подарков
const GIFT_SWIPE = inter.GESTURE_DOWN   // каким свайпом открывается экран подарков (остальные — экран настройки ценности)
const HSZ = 40                // размер ❤️
const HSTEP = 47              // шаг ❤️ (8 штук = 369 px)
const HPER = 8                // ❤️ в строке
const HMAX = 16               // не больше двух строк
const HY = 62                 // верх первой строки ❤️
const HROW = 46               // расстояние между строками ❤️
const GFT_Y = 180             // верх большого 🎁 (160 px)
const GFT_SZ = 160
const GL_Y = 345              // подпись «x N» под подарком
const GL_SIZE = 24            // размер подписи (очень мелкая)
const WHITE = 0xffffff
const BLACK = 0x000000
const BTN_BLACK = 0x050505
const RED = 0xff4517
const GREEN = 0x3bf76d
const GRAY = 0x8c8c8c
// цвет цифр на цветных таймерах
const OV_FG = { r: WHITE, g: BLACK, y: BLACK }
const OV_BG = { r: RED, g: GREEN, y: GRAY }

// эмодзи занятий в порядке картинок i0..i8 / q0..q8; приложение-трекер на телефоне по эмодзи понимает занятие
const EMOJI = ['\u{1F93F}', '\u{1F3A8}', '\u{1FA78}', '\u{1F4D6}', '\u{1F9EC}', '\u{1F480}', '\u{1F3E0}', '\u{1F340}', '\u{1F50D}']

// Хранилище: если часы его не дают (нет разрешения и т.п.), работаем в памяти и показываем причину на экране
let ls = null
const mem = {}
const store = {
  getItem(k, d) {
    try { if (ls) { const v = ls.getItem(k, d); return v === undefined || v === null ? d : v } } catch (e) { fail('getItem ' + e) }
    return k in mem ? mem[k] : d
  },
  setItem(k, v) {
    mem[k] = v
    try { if (ls) ls.setItem(k, v) } catch (e) { fail('setItem ' + e) }
  }
}

// Ошибки показываем на экране (а не оставляем чёрный экран): без этого на часах их не увидеть
let failed = 0
function fail(msg) {
  failed++
  if (failed > 3) return
  try {
    createWidget(widget.FILL_RECT, { x: 0, y: 0, w: 432, h: 514, color: 0x300000 })
    createWidget(widget.TEXT, {
      x: 12, y: 12 + (failed - 1) * 150, w: 408, h: 140, color: 0xffffff, text_size: 22,
      align_h: align.LEFT, align_v: align.TOP, text_style: text_style.WRAP, text: 'Ошибка ' + failed + ': ' + String(msg).slice(0, 160)
    })
  } catch (e) { /* больше показать нечем */ }
}
function guard(name, f) {
  try { return f() } catch (e) { fail(name + ': ' + e); return undefined }
}

let ST = null          // обычное состояние (хранится)
let STT = null         // тестовое состояние (хранится, чтобы пережить перезапуск)
let testMode = false
let view = 'main'      // 'main' — занятия и очередь, 'settings' — ценность 🩸, 'gift' — подарки, 'ov' — цветной таймер на весь экран
let vib = null
let inflight = false
let inflightAt = 0
let syncing = false
let syncAt = 0
let timer = null
let ticks = 0
let lpAt = 0           // когда сработало долгое нажатие (чтобы отпускание пальца не считалось обычным нажатием)
let shown = []         // для каждого квадрата: показана ли кнопка идущего таймера
let lastLabel = []
let lastOv = ''
let lastQ = ''
let idle = []
let runb = []
let qb = []            // qb[k][e] — значок очереди: место k, эмодзи e (у каждой пары своя кнопка с готовой картинкой)
let qItems = []        // очередь с телефона (эмодзи)
let gifts = { n: 0, h: 0 }   // с телефона: сколько 🎁 доступно и сколько уже превращено в ❤️
let gBg = null
let gGift = null
let gLabel = null
let hearts = [[], []]  // для каждой строки ❤️: { off, b } — смещение от центра в шагах и кнопка
let lastG = ''
let me = null          // страница (нужна обработчикам жестов)
let sBg = null
let sEmoji = null
let sLabel = null
let ov = { r: null, g: null, y: null }
let ovS = { r: null, g: null, y: null }   // полоса справа от цифр (чтобы цвет закрывал весь экран)
let launch = ''        // с каким параметром открыта страница ('alarm' — разбудил будильник)
let G = null           // геометрия
let ROW = 171          // высота одной из трёх строк экрана

function cur() { return testMode ? STT : ST }

function save() {
  try {
    store.setItem('st', JSON.stringify(ST))
    store.setItem('tm', testMode ? '1' : '0')
    if (testMode && STT) store.setItem('stt', JSON.stringify(STT))   // тест тоже хранится: приложение может перезапуститься будильником
  } catch (e) { /* без сохранения продолжаем работать */ }
}

function vibrate(mode) {
  try {
    if (!vib) vib = new Vibrator()
    vib.start({ mode: mode })
  } catch (e) {
    try { vib.setMode({ mode: mode }); vib.start() } catch (e2) { /* нет вибромотора */ }
  }
}

function signalHour() { vibrate(VIBRATOR_SCENE_DURATION_LONG) }

function geometry() {
  let h = 514
  try {
    const d = getDeviceInfo()
    if (d && d.height > 0) h = Math.min(d.height, 514)
  } catch (e) { /* значения по умолчанию */ }
  // ширина всегда 432 (designWidth приложения): реальная ширина экрана могла быть больше и уводила сетку за край
  ROW = Math.floor(h / 3)
  return { w: SCREEN_W, h: h, cell: CELL, font: Math.round(CELL * 0.5) }
}

/** Кнопка занятия i: ряд 0 — средняя треть экрана, ряд 1 — нижняя; по центру своей трети. */
function cellXY(i) {
  const c = i % 3
  const r = Math.floor(i / 3)
  return { x: LEFT + c * (CELL + GAP), y: ROW * (1 + r) + Math.round((ROW - CELL) / 2) }
}

function setBtn(b, x, y, w, h, text, color) {
  try { b.setProperty(prop.MORE, { x: x, y: y, w: w, h: h, text: text, color: color }) } catch (e) { /* не критично */ }
}

function setVisible(b, v) {
  try { if (b) b.setProperty(prop.VISIBLE, v) } catch (e) { /* не критично */ }
}

/** Ряд очереди: значки по эмодзи из qItems (только на главном экране). Картинку на кнопке менять нельзя
 *  (часы её не обновляют — все значки были 🤿), поэтому у каждого места есть по кнопке на каждое эмодзи, а показывается одна. */
function renderQueue() {
  const key = view + '|' + qItems.join(',')
  if (key === lastQ) return
  lastQ = key
  for (let k = 0; k < QMAX; k++) {
    const idx = k < qItems.length ? EMOJI.indexOf(qItems[k]) : -1
    for (let e = 0; e < EMOJI.length; e++) setVisible(qb[k] && qb[k][e], view === 'main' && e === idx)
  }
}

function setQueue(arr) {
  if (!arr || arr.length === undefined) return
  const items = []
  for (let k = 0; k < arr.length && items.length < QMAX; k++) items.push(String(arr[k]))
  if (items.join(',') === qItems.join(',')) return
  qItems = items
  try { store.setItem('qq', JSON.stringify(items)) } catch (e) { /* не критично */ }
  renderQueue()
}

function setGifts(g) {
  if (!g) return
  const n = Math.max(0, Math.floor(+g.n || 0))
  const h = Math.max(0, Math.floor(+g.h || 0))
  if (n === gifts.n && h === gifts.h) return
  gifts = { n: n, h: h }
  try { store.setItem('gs', JSON.stringify(gifts)) } catch (e) { /* не критично */ }
  renderGift()
}

/** Экран подарков: ❤️ сверху (строки по центру), большой 🎁 и подпись «x N»; при N = 0 сам 🎁 не показывается. */
function renderGift() {
  const on = view === 'gift'
  const cnt = Math.min(gifts.h, HMAX)
  const key = (on ? 'on' : 'off') + '|' + gifts.n + '|' + cnt
  if (key === lastG) return
  lastG = key
  setVisible(gBg, on)
  setVisible(gGift, on && gifts.n > 0)
  setVisible(gLabel, on)
  if (on) setBtn(gLabel, CX - 60, GL_Y, 120, 40, 'x ' + gifts.n, WHITE)
  for (let r = 0; r < 2; r++) {
    const k = Math.max(0, Math.min(HPER, cnt - r * HPER))   // сколько ❤️ в этой строке
    for (let j = 0; j < hearts[r].length; j++) {
      const o = hearts[r][j].off
      // при k сердечках смещения: -(k-1)/2 ... (k-1)/2 с шагом 1
      const d = o + (k - 1) / 2
      const show = on && k > 0 && Math.abs(d - Math.round(d)) < 0.01 && Math.round(d) >= 0 && Math.round(d) < k
      setVisible(hearts[r][j].b, show)
    }
  }
}

/** Переключить экран: показать нужные виджеты, остальные спрятать. */
function enterView(v) {
  view = v
  for (let i = 0; i < core.COUNT; i++) { setVisible(idle[i], false); setVisible(runb[i], false) }
  shown = []
  lastLabel = []
  lastOv = ''
  lastQ = ''
  lastG = ''
  renderQueue()
  renderGift()
  setVisible(sBg, v === 'settings')
  setVisible(sEmoji, v === 'settings')
  setVisible(sLabel, v === 'settings')
  const k = v === 'ov' ? cur().q.k : ''
  for (const c of ['r', 'g', 'y']) { setVisible(ov[c], k === c); setVisible(ovS[c], k === c) }
}

/** Перерисовать то, что поменялось. */
function render(now) {
  const st = cur()
  if (view === 'main') {
    for (let i = 0; i < core.COUNT; i++) {
      const isRun = core.running(st, i)
      if (shown[i] !== isRun) {
        setVisible(idle[i], !isRun)
        setVisible(runb[i], isRun)
        shown[i] = isRun
        lastLabel[i] = ''
      }
      if (isRun) {
        const text = core.label(st, core.remaining(st, i, now))
        if (text !== lastLabel[i]) {
          const p = cellXY(i)
          setBtn(runb[i], p.x, p.y, G.cell, G.cell, text, WHITE)
          lastLabel[i] = text
        }
      }
    }
  } else if (view === 'ov') {
    const k = st.q.k
    const text = core.clock(core.ovLeft(st, now))
    if (k + text !== lastOv && ov[k]) {
      setBtn(ov[k], 0, 0, OV_W, G.h, text, OV_FG[k])
      lastOv = k + text
    }
  }
}

function updateValLabel() {
  setBtn(sLabel, 46, 282, 340, 90, ST.val + ' мин', WHITE)
}

function openSettings() {
  enterView('settings')
  updateValLabel()
}

function closeSettings() {
  save()
  enterView('main')
  render(Date.now())
}

function openGift() {
  enterView('gift')
  if (me) { try { me.syncQueue(true) } catch (e) { /* не критично */ } }   // свежее число 🎁 и ❤️
}

function closeGift() {
  enterView('main')
  render(Date.now())
}

/** Нажатие на 🩸 на экране настройки: 60 -> 45 -> 30 -> 60. */
function cycleVal() {
  const v = core.nextVal(ST.val)
  ST.val = v
  if (STT) STT.val = v
  save()
  updateValLabel()
}

/** Будильники на моменты окончания: разбудят приложение, если экран погас. */
function scheduleAlarms(now) {
  if (!USE_ALARM) return
  try {
    const old = JSON.parse(store.getItem('alarms', '[]'))
    for (let k = 0; k < old.length; k++) { try { alarmCancel(old[k]) } catch (e) { /* уже сработал */ } }
  } catch (e) { /* нет старых */ }
  const ids = []
  const due = core.nextDue(cur())
  // номер поколения: служба сверяет его с сохранённым и молчит, если будильники уже переставлены
  const gen = String(now % 1000000000)
  try { store.setItem('gen', gen) } catch (e) { /* не критично */ }
  const every = Math.round(core.fullMs(cur()) / 1000)
  for (let k = 0; k < due.length; k++) {
    const delay = Math.max(1, Math.ceil((due[k].t - now) / 1000) + 1)
    // 1) служба: вибрирует (работает при погасшем экране) и для занятий сама ставит следующий будильник
    try {
      const id = alarmSet({ url: 'app-service/alarm', param: due[k].kind + '|' + gen + '|' + every, delay: delay })
      if (id) ids.push(id)
    } catch (e) { /* без службы */ }
    // 2) страница: открывается чуть позже, считает и отправляет событие на телефон
    try {
      const id = alarmSet({ url: 'page/index', param: 'alarm', delay: delay + 3 })
      if (id) ids.push(id)
    } catch (e) { /* без страницы */ }
  }
  try { store.setItem('alarms', JSON.stringify(ids)) } catch (e) { /* не критично */ }
}

function keepAwake() {
  if (!KEEP_AWAKE || !core.anyRunning(cur())) return
  try { setPageBrightTime({ brightTime: 120000 }) } catch (e) { /* не критично */ }
  try { pauseDropWristScreenOff({ duration: 600000 }) } catch (e) { /* не критично */ }
}

/** Свайп: на цветном таймере и пока что-то идёт — гасим (выйти нельзя); на открытом экране настройки или подарков —
 *  закрываем; на главном экране, когда ничего не идёт: свайп вниз — подарки, остальные — настройка ценности.
 *  true — «система, не обрабатывай». */
function onSwipe(e) {
  if (view === 'settings') { closeSettings(); return true }
  if (view === 'gift') { closeGift(); return true }
  if (view === 'ov') return true
  if (core.anyRunning(cur())) return true
  if (e === GIFT_SWIPE) openGift()
  else openSettings()
  return true
}

/** Пока идёт таймер, выйти из приложения нельзя: гасим кнопки (true — «система, не обрабатывай»). */
function blockExit() {
  try {
    inter.onGesture({
      callback: function (e) {
        const swipe = e === inter.GESTURE_RIGHT || e === inter.GESTURE_LEFT || e === inter.GESTURE_UP || e === inter.GESTURE_DOWN
        if (!swipe) return false
        return guard('жест', () => onSwipe(e))
      }
    })
  } catch (e) { /* без обработки жестов */ }
  try {
    inter.onKey({
      callback: function (key, keyEvent) {
        if (!core.anyRunning(cur())) return false
        return key === inter.KEY_BACK || key === inter.KEY_HOME || key === inter.KEY_SELECT || key === inter.KEY_SHORTCUT
      }
    })
  } catch (e) { /* без блокировки кнопок */ }
}

/** Сообщение телефону для события из очереди отправки. */
function payloadFor(ev) {
  if (ev.k === 'q') return { t: 'qtap', id: ev.id, ts: ev.ts }
  if (ev.k === 'g') return { t: 'gift', id: ev.id, ts: ev.ts }
  if (ev.k === 'b') return { t: 'blood', id: ev.id, e: EMOJI[ev.i], ts: ev.ts, ms: ev.ms, f: ev.f ? 1 : 0 }
  return { t: 'done', id: ev.id, e: EMOJI[ev.i], ts: ev.ts }   // событие старого вида (из прошлых версий)
}

Page(
  BasePage({
    onInit(p) {
      try { if (!ls) ls = new LocalStorage() } catch (e) { /* ошибка покажется в build */ }
      launch = typeof p === 'string' ? p : ''
    },

    build() {
      me = this
      guard('старт', () => { ls = new LocalStorage() })
      G = guard('экран', geometry)
      guard('открытие', () => setWakeUpRelaunch({ relaunch: true }))   // при включении экрана открывается это приложение
      ST = guard('состояние', () => core.restore(store.getItem('st', ''), false, 60)) || core.newState(false, 60)
      testMode = store.getItem('tm', '0') === '1'
      STT = testMode ? core.restore(store.getItem('stt', ''), true, ST.val) : null
      try {
        const q = JSON.parse(store.getItem('qq', '[]'))
        qItems = []
        for (let k = 0; k < q.length && qItems.length < QMAX; k++) qItems.push(String(q[k]))
      } catch (e) { qItems = [] }
      try {
        const g = JSON.parse(store.getItem('gs', '{}'))
        gifts = { n: Math.max(0, Math.floor(+g.n || 0)), h: Math.max(0, Math.floor(+g.h || 0)) }
      } catch (e) { gifts = { n: 0, h: 0 } }
      blockExit()
      shown = []
      lastLabel = []
      idle = []
      runb = []
      qb = []

      // очередь (верхняя треть экрана): значки-кнопки; долгое нажатие — серый таймер.
      // На каждое место по кнопке на каждое эмодзи (картинка на кнопке не меняется), показывается нужная.
      const qy = Math.round((ROW - QSZ) / 2)
      for (let k = 0; k < QMAX; k++) {
        qb.push([])
        for (let e = 0; e < EMOJI.length; e++) {
          guard('очередь ' + k + '/' + e, () => {
            const b = createWidget(widget.BUTTON, {
              x: LEFT + k * QSTEP, y: qy, w: QSZ, h: QSZ, text: '', normal_src: 'q' + e + '.png', press_src: 'q' + e + '.png',
              click_func: () => { /* обычное нажатие ничего не делает */ },
              longpress_func: () => { guard('серый', () => this.queueLong()) }
            })
            setVisible(b, false)
            qb[k].push(b)
          })
        }
      }

      for (let i = 0; i < core.COUNT; i++) {
        const k = i
        guard('кнопка ' + i, () => {
          const p = cellXY(i)
          idle.push(createWidget(widget.BUTTON, {
            x: p.x, y: p.y, w: G.cell, h: G.cell, text: '', normal_src: 'i' + i + '.png', press_src: 'i' + i + '.png',
            click_func: () => { guard('нажатие', () => this.cellTap(k)) },
            longpress_func: () => { guard('долгое', () => this.cellLong(k)) }
          }))
          // идущий таймер: только цифры на чёрном, эмодзи полностью скрыто
          const rb = createWidget(widget.BUTTON, {
            x: p.x, y: p.y, w: G.cell, h: G.cell, text: '60', text_size: G.font, color: WHITE,
            normal_color: BTN_BLACK, press_color: 0x1c1c1c, radius: 0,
            click_func: () => { guard('нажатие', () => this.cellTap(k)) },
            longpress_func: () => { guard('долгое', () => this.cellLong(k)) }
          })
          setVisible(rb, false)
          runb.push(rb)
        })
      }

      // экран настройки ценности 🩸: чёрный фон, 🩸 по центру, снизу ценность; любое нажатие меняет её, долгое — закрывает
      guard('настройка', () => {
        const cyc = () => { guard('ценность', cycleVal) }
        const close = () => { guard('закрыть', () => { lpAt = Date.now(); closeSettings() }) }
        sBg = createWidget(widget.BUTTON, {
          x: 0, y: 0, w: G.w, h: G.h, text: '', normal_color: BLACK, press_color: BLACK, radius: 0,
          click_func: cyc, longpress_func: close
        })
        sEmoji = createWidget(widget.BUTTON, {
          x: Math.round((G.w - 120) / 2), y: 130, w: 120, h: 120, text: '', normal_src: 'i2.png', press_src: 'i2.png',
          click_func: cyc, longpress_func: close
        })
        sLabel = createWidget(widget.BUTTON, {
          x: 46, y: 282, w: 340, h: 90, text: '60 мин', text_size: 56, color: WHITE,
          normal_color: BLACK, press_color: BLACK, radius: 0,
          click_func: cyc, longpress_func: close
        })
        setVisible(sBg, false)
        setVisible(sEmoji, false)
        setVisible(sLabel, false)
      })

      // экран подарков 🎁: чёрный фон, сверху ❤️, по центру большой 🎁, под ним мелкая подпись; долгое нажатие закрывает
      guard('подарки', () => {
        const none = () => { /* обычное нажатие ничего не делает */ }
        const close = () => { guard('закрыть', () => { lpAt = Date.now(); closeGift() }) }
        gBg = createWidget(widget.BUTTON, {
          x: 0, y: 0, w: G.w, h: G.h, text: '', normal_color: BLACK, press_color: BLACK, radius: 0,
          click_func: none, longpress_func: close
        })
        for (let r = 0; r < 2; r++) {
          // положения ❤️ при любом числе в строке (1..8): смещения от центра -3.5 ... 3.5 с шагом 0.5 (целые — для нечётного
          // числа, дробные — для чётного); у каждого положения своя кнопка, показываются нужные
          for (let o2 = -7; o2 <= 7; o2++) {
            const off = o2 / 2
            if (Math.abs(off) > 3.5) continue
            const b = createWidget(widget.BUTTON, {
              x: Math.round(CX + off * HSTEP - HSZ / 2), y: HY + r * HROW, w: HSZ, h: HSZ, text: '',
              normal_src: 'h.png', press_src: 'h.png', click_func: none, longpress_func: close
            })
            setVisible(b, false)
            hearts[r].push({ off: off, b: b })
          }
        }
        gGift = createWidget(widget.BUTTON, {
          x: CX - GFT_SZ / 2, y: GFT_Y, w: GFT_SZ, h: GFT_SZ, text: '', normal_src: 'g.png', press_src: 'g.png',
          click_func: none, longpress_func: close
        })
        gLabel = createWidget(widget.BUTTON, {
          x: CX - 60, y: GL_Y, w: 120, h: 40, text: 'x 0', text_size: GL_SIZE, color: WHITE,
          normal_color: BLACK, press_color: BLACK, radius: 0, click_func: none, longpress_func: close
        })
        setVisible(gBg, false)
        setVisible(gGift, false)
        setVisible(gLabel, false)
      })

      // цветные таймеры на весь экран: красный, зелёный, серый; тап не делает ничего, долгое нажатие — досрочный выход.
      // Цифры стоят по центру CX (чуть левее середины экрана), справа полоса того же цвета.
      const makeOv = (kind) => {
        guard('таймер ' + kind, () => {
          const exit = () => { guard('выход', () => this.ovExit()) }
          const b = createWidget(widget.BUTTON, {
            x: 0, y: 0, w: OV_W, h: G.h, text: '', text_size: 110, color: OV_FG[kind],
            normal_color: OV_BG[kind], press_color: OV_BG[kind], radius: 0,
            click_func: () => { /* обычное нажатие ничего не делает */ },
            longpress_func: exit
          })
          const strip = createWidget(widget.BUTTON, {
            x: OV_W, y: 0, w: G.w - OV_W, h: G.h, text: '',
            normal_color: OV_BG[kind], press_color: OV_BG[kind], radius: 0,
            click_func: () => { /* обычное нажатие ничего не делает */ },
            longpress_func: exit
          })
          setVisible(b, false)
          setVisible(strip, false)
          ov[kind] = b
          ovS[kind] = strip
        })
      }
      makeOv('r')
      makeOv('g')
      makeOv('y')

      guard('экран старта', () => enterView(core.overlayActive(cur()) ? 'ov' : 'main'))
      const now = Date.now()
      guard('запуск', () => this.settle(core.process(cur(), now), now))   // то, что закончилось, пока приложение было закрыто
      if (launch === 'alarm') { try { setPageBrightTime({ brightTime: 20000 }) } catch (e) { /* не критично */ } }
      guard('очередь', () => this.syncQueue())
      timer = setInterval(() => { guard('секунда', () => this.tick()) }, 1000)
    },

    onDestroy() {
      if (timer) { clearInterval(timer); timer = null }
      save()
    },

    /** Всё, что нужно сделать после любого изменения состояния. */
    settle(res, now) {
      if (res.fresh) signalHour()
      if (res.ovDone && res.ovFresh) signalHour()          // конец цветного таймера — та же вибрация, что в конце занятия
      if (res.ovDone && view === 'ov') enterView('main')   // закончившийся цветной таймер закрывается сам, приложение остаётся
      save()
      scheduleAlarms(now)
      keepAwake()
      render(now)
      this.sendDue(now)
    },

    tick() {
      const now = Date.now()
      ticks++
      const res = core.process(cur(), now)
      if (res.events.length || res.ovDone) {
        this.settle(res, now)
      } else {
        render(now)
        this.sendDue(now)
        if (ticks % 60 === 0) { keepAwake(); this.syncQueue() }
      }
    },

    cellTap(i) {
      const now = Date.now()
      if (now - lpAt < 800 || view !== 'main') return
      this.settle(core.toggle(cur(), i, now), now)
    },

    /** Долгое нажатие на кнопку занятия: верхний ряд — зелёный, нижний — красный, 📖 — тестовый режим. */
    cellLong(i) {
      const now = Date.now()
      lpAt = now
      if (view !== 'main') return
      if (i === 3) { this.toggleTest(); return }
      this.startOv(i < 3 ? 'g' : 'r')
    },

    /** Долгое нажатие на очередь: серый таймер. */
    queueLong() {
      lpAt = Date.now()
      if (view !== 'main') return
      this.startOv('y')
    },

    startOv(kind) {
      const now = Date.now()
      const res = core.startOverlay(cur(), kind, now)
      enterView('ov')
      this.settle(res, now)
    },

    ovExit() {
      const now = Date.now()
      lpAt = now
      const r = core.exitOverlay(cur(), now)   // зелёный и при досрочном выходе шлёт «нажатие на 🎁»
      enterView('main')
      this.settle(r.res, now)
    },

    /** Долгое нажатие на 📖: войти в тестовый режим или выйти из него (только когда ничего не идёт). */
    toggleTest() {
      if (core.anyRunning(cur())) return
      testMode = !testMode
      STT = testMode ? core.newState(true, ST.val) : null
      if (!testMode) { try { store.setItem('stt', '') } catch (e) { /* не критично */ } }
      enterView('main')
      const now = Date.now()
      this.settle(core.process(cur(), now), now)
      signalHour()
    },

    /** Спросить у телефона очередь занятий. */
    syncQueue(force) {
      const now = Date.now()
      if (!force && syncing && now - syncAt < 30000) return
      syncing = true
      syncAt = now
      this.request({ method: 'u613.send', params: { t: 'sync' } })
        .then((res) => {
          syncing = false
          const r = res && res.ok ? res.reply : null
          if (r && r.q) setQueue(r.q)
          if (r && r.g) setGifts(r.g)
        })
        .catch(() => { syncing = false })
    },

    /** Отправить телефону одно неподтверждённое событие (по одному за раз). */
    sendDue(now) {
      if (inflight && now - inflightAt < 30000) return
      const states = testMode ? [ST, STT] : [ST]
      let target = null
      let owner = null
      for (let s = 0; s < states.length && !target; s++) {
        const d = core.due(states[s], now, SEND_GAP)
        if (d.length) { target = d[0]; owner = states[s] }
      }
      if (!target) return
      target.tried = now
      inflight = true
      inflightAt = now
      const id = target.id
      this.request({ method: 'u613.send', params: payloadFor(target) })
        .then((res) => {
          inflight = false
          const r = res && res.ok ? res.reply : null
          if (r && r.q) setQueue(r.q)
          if (r && r.g) setGifts(r.g)
          if (r && r.t === 'ack' && r.id === id) {
            core.ack(owner, id)
            save()
            this.sendDue(Date.now())
          }
        })
        .catch(() => { inflight = false })
    }
  })
)
