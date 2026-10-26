// Gentle reminder drafts. Families are not debt collectors: the tone is warm, specific and never shaming.
import { fmt } from '../money.js';

const CAT = {
  en: { clinic: 'clinic visits', medicine: 'medicine', home_nurse: 'the home nurse', therapy: 'physio', supplies: 'care supplies', transport: 'transport', other: 'other costs' },
  ms: { clinic: 'klinik', medicine: 'ubat', home_nurse: 'jururawat rumah', therapy: 'fisio', supplies: 'barang keperluan', transport: 'pengangkutan', other: 'lain-lain' },
  zh: { clinic: '看诊', medicine: '药物', home_nurse: '居家护士', therapy: '物理治疗', supplies: '护理用品', transport: '交通', other: '其他' },
};
const list = (arr, lang) => arr.length <= 1 ? (arr[0] || '') : lang === 'zh' ? arr.join('、') : `${arr.slice(0, -1).join(', ')} ${lang === 'ms' ? 'dan' : 'and'} ${arr.at(-1)}`;

export function draftNudge({ lang = 'en', name, parentName = 'Mak', amount, currency = 'MYR', topCategories = [], link, coordinator = 'me', partial = true }) {
  const cats = list(topCategories.slice(0, 3).map((c) => CAT[lang]?.[c] || c), lang);
  const amt = fmt(amount, currency);
  if (lang === 'ms') return `Assalamualaikum ${name}, harap sihat. Ini ringkasan belanja ${parentName} bulan ni (${cats}). Bahagian ${name} ${amt}, dah tolak masa jagaan yang semua orang bagi. Boleh bayar terus melalui PayPal di sini: ${link}${partial ? '. Boleh bayar sikit-sikit kalau lebih senang.' : '.'} Terima kasih sebab sama-sama jaga ${parentName}. – ${coordinator}`;
  if (lang === 'zh') return `${name}你好！这是${parentName}这个月的护理开销（${cats}）。扣除大家照顾的时间后，你的部分是 ${amt}。可以直接用 PayPal 支付：${link}${partial ? '。分期付也可以。' : '。'}谢谢你一起照顾${parentName}！– ${coordinator}`;
  return `Hi ${name}, hope you're well! Here's ${parentName}'s care summary for this month (${cats}). Your share comes to ${amt}, after counting everyone's caregiving time. You can pay through PayPal here: ${link}${partial ? '. Paying in parts is fine too.' : '.'} Thank you for looking after ${parentName} with us. – ${coordinator}`;
}
