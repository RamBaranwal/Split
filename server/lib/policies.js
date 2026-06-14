export const MEMBERSHIP = {
  Aisha: { joinDate: '2026-02-01', leaveDate: null },
  Rohan: { joinDate: '2026-02-01', leaveDate: null },
  Priya: { joinDate: '2026-02-01', leaveDate: null },
  Meera: { joinDate: '2026-02-01', leaveDate: '2026-03-31' },
  Dev: { joinDate: '2026-02-08', leaveDate: '2026-03-14' },
  Sam: { joinDate: '2026-04-10', leaveDate: null },
  Kabir: { joinDate: '2026-03-11', leaveDate: '2026-03-11' }
};

export const NAME_ALIASES = {
  aisha: 'Aisha',
  rohan: 'Rohan',
  'rohan ': 'Rohan',
  priya: 'Priya',
  'priya s': 'Priya',
  meera: 'Meera',
  dev: 'Dev',
  sam: 'Sam',
  kabir: 'Kabir',
  "dev's friend kabir": 'Kabir'
};

export const USD_TO_INR_RATE = Number(process.env.USD_TO_INR_RATE || 83);
export const IMPORT_YEAR = Number(process.env.IMPORT_YEAR || 2026);

export function normaliseName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return NAME_ALIASES[raw.toLowerCase()] || raw;
}

export function inMembershipWindow(member, isoDate) {
  const window = MEMBERSHIP[member];
  if (!window || !isoDate) return false;
  return isoDate >= window.joinDate && (!window.leaveDate || isoDate <= window.leaveDate);
}
