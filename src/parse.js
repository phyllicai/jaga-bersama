// Offline understanding of family care messages (English, Bahasa Melayu, Manglish, simple 中文).
// Used when no LLM is configured, and as a validator/fallback for LLM output.
import { toMinor } from './money.js';

export const CATEGORIES = ['clinic', 'medicine', 'home_nurse', 'therapy', 'supplies', 'transport', 'other'];
const CAT_RULES = [
  ['home_nurse', /\b(home ?nurse|nurse|jururawat|caregiver|penjaga|maid|pembantu|day ?care|jagaan harian)\b|看护|护工|保姆/i],
  ['therapy', /\b(physio|fisio\w*|therapy|terapi|rehab)\b|物理治疗|复健/i],
  ['transport', /\b(grab|teksi|taxi|transport|petrol|minyak|parking|letak kereta|tol|toll|ambulans|ambulance)\b|车费|停车|油钱/i],
  ['clinic', /\b(klinik|clinic|doktor|doctor|dr\.?|hospital|hosp|specialist|pakar|consult\w*|check-?up|appointment|temujanji|lab|blood test|ujian darah|x-?ray|scan)\b|诊所|医生|医院|看病|复诊/i],
  ['medicine', /\b(ubat|medicine|meds?|pharmacy|farmasi|insulin|tablet|pil|pills?|guardian|watson'?s|caring|vitamin|supplement)\b|药/i],
  ['supplies', /\b(pampers|lampin|diapers?|adult diaper|susu|milk|ensure|anlene|glucerna|wheelchair|kerusi roda|walker|tongkat|barang|groceries|grocery|barang dapur|kain|bed ?pad|tilam)\b|尿片|奶粉|轮椅|用品/i],
];
export function categorize(text) {
  for (const [cat, re] of CAT_RULES) if (re.test(text)) return cat;
  return 'other';
}

const AMOUNT = /(?:RM|MYR|rm)\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(?:ringgit|rm\b|令吉|块)/gi;
const QTY = /(\d+)\s?(?:x|kali|visits?|lawatan|sessions?|sesi|boxes|kotak|pek|packs?|次|盒|包)\b|(\d+)\s?(?:x|次|盒|包)/i;
const EACH = /\b(each|setiap|satu|per (?:visit|session|box|pack)|sekali)\b|每/i;
const SELF = /\b(i|i've|ive|saya|aku|sy|me)\b|我/i;
const PAIDVERB = /\b(paid|pay|bayar|bayarkan|dah bayar|settle|top ?up|belanja|beli|bought|spent|cover)\b|付|买/i;
const HOURS = /(\d+(?:\.\d+)?)\s?(?:jam|hours?|hrs?|h\b|小时)/i;
const CAREVERB = /\b(jaga|look(?:ed)? after|care|cared|teman|accompan\w*|hantar|bawa|drove|drive|took|temankan|tunggu|stayed|tidur)\b|照顾|陪|载/i;

function splitClauses(text) {
  const out = [];
  for (const line of String(text).split(/\n|;|。|(?<!\b(?:Dr|Mr|Mrs|Ms|Dato|Datin|St))\.(?=\s+[A-Za-z\u4e00-\u9fff])/)) {
    const l = line.trim(); if (!l) continue;
    const n = [...l.matchAll(AMOUNT)].length;
    if (n < 2 || /\b(total|jumlah|semua)\b|共/i.test(l)) { out.push({ text: l, line: l }); continue; }
    // Several amounts on one line: split on commas / "and" / "dan", then glue amount-less context onto the next piece.
    const parts = l.split(/,\s*|，|\s+(?:and|dan|lepas tu|then|juga)\s+/i).map((x) => x.trim()).filter(Boolean);
    let carry = '';
    const pieces = [];
    for (const part of parts) {
      if ([...part.matchAll(AMOUNT)].length) { pieces.push((carry + ' ' + part).trim()); carry = ''; } else carry = (carry + ' ' + part).trim();
    }
    if (carry) pieces.length ? (pieces[pieces.length - 1] += ' ' + carry) : pieces.push(carry);
    out.push(...pieces.map((t) => ({ text: t, line: l })));
  }
  return out;
}

function findMember(clause, members) {
  let best = null;
  for (const m of members) {
    const names = [m.name, ...(m.aliases || [])].filter(Boolean);
    for (const n of names) {
      const re = new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu');
      const idx = clause.search(re);
      if (idx >= 0 && (best === null || idx < best.idx)) best = { m, idx };
    }
  }
  return best?.m || null;
}

function dateFrom(clause, today) {
  const d = new Date(today + 'T00:00:00Z');
  if (/\b(semalam|yesterday|kelmarin)\b|昨天/i.test(clause)) d.setUTCDate(d.getUTCDate() - 1);
  const m = clause.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : d.getUTCFullYear(); return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  return d.toISOString().slice(0, 10);
}

function cleanDesc(clause) {
  return clause.replace(AMOUNT, '').replace(/\s{2,}/g, ' ').replace(/^[\s,\-–:]+|[\s,\-–:]+$/g, '').slice(0, 80) || 'Care expense';
}

// Returns { expenses:[{description, category, amount(minor), paidBy, date}], careLogs:[{memberId, hours, date, note}], unparsed:[] }
export function parseMessage(text, { members = [], speakerId = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const expenses = [], careLogs = [], unparsed = [];
  for (const { text: clause, line } of splitClauses(text)) {
    const amounts = [...clause.matchAll(AMOUNT)].map((m) => toMinor((m[1] || m[2]).replace(/,/g, ''))).filter((n) => n > 0);
    const who = findMember(clause, members) || (line !== clause && PAIDVERB.test(line) ? findMember(line, members) : null);
    const date = dateFrom(clause, today);
    if (amounts.length) {
      let amount = amounts.length > 1 && /\b(total|jumlah|semua)\b|共/i.test(clause) ? Math.max(...amounts) : amounts[0];
      const q = clause.match(QTY);
      const qty = q ? +(q[1] || q[2]) : 1;
      if (qty > 1 && EACH.test(clause)) amount *= qty;
      // Who paid: a named sibling with a "paid" verb, else the named sibling, else the speaker.
      let paidBy = speakerId;
      if (who && (PAIDVERB.test(line) || !SELF.test(clause))) paidBy = who.id;
      if (/\b(fund|tabung|akaun bersama|care fund)\b|基金/i.test(clause)) paidBy = null;
      expenses.push({ description: cleanDesc(clause), category: categorize(clause), amount, paidBy, date, quantity: qty });
      continue;
    }
    const h = clause.match(HOURS);
    if (h && CAREVERB.test(clause)) {
      const member = who && !SELF.test(clause.slice(0, clause.search(new RegExp(who.name, 'i')))) ? who : (members.find((m) => m.id === speakerId) || who);
      if (member) { careLogs.push({ memberId: member.id, hours: +h[1], date, note: clause.slice(0, 80) }); continue; }
    }
    if (clause.length > 2) unparsed.push(clause);
  }
  return { expenses, careLogs, unparsed };
}
