// Demo family (fictional). Emails are placeholders; replace with your sandbox personal-account emails.
export function demoFamily() {
  return {
    parentName: 'Mak', parentFull: 'Puan Rohani, 78',
    fundName: 'Tabung Mak (family care fund)',
    currency: 'MYR', carerRate: 1500, countCareTime: true,
    approvalCap: 50000, // above RM500, a money action needs two siblings to approve
    coordinatorId: 'aisyah',
    members: [
      { id: 'aisyah', name: 'Aisyah', aliases: ['Kak Long', 'Kak Aisyah'], city: 'Shah Alam', email: 'aisyah.demo@example.com', weight: 1, role: 'Lives 10 min from Mak, main carer' },
      { id: 'farid', name: 'Farid', aliases: ['Angah'], city: 'Singapore', email: 'farid.demo@example.com', weight: 1.5, role: 'Engineer in Singapore, agreed to pay a bigger share' },
      { id: 'hakim', name: 'Hakim', aliases: ['Adik'], city: 'Perth', email: 'hakim.demo@example.com', weight: 1, role: 'Postgrad in Perth, visits twice a year' },
    ],
  };
}
export const DEMO_MESSAGES = [
  { speakerId: 'aisyah', text: 'Bawa Mak ke klinik Dr. Lim semalam, consult RM85\nUbat darah tinggi & kencing manis RM126.40. Grab balik RM18\nHome nurse Kak Siti 4 visits RM120 each\nSaya jaga Mak 14 jam minggu ni' },
  { speakerId: 'farid', text: 'I paid for adult diapers RM89.90 and Ensure milk RM112 on Shopee, delivered to Mak' },
  { speakerId: 'hakim', text: 'Hakim covered the physio session, 150 ringgit' },
];
