// GLP-1 medicine catalogue, injection sites and daily check-in scales.
//
// Dose steps are the usual label escalation steps (check the patient leaflet:
// regional labels differ and new strengths appear). Any other dose can still
// be typed in. This is reference data for logging, not dosing advice.

export const GLP1_MEDS = [
  {
    id: 'ozempic', label: 'Ozempic', generic: 'semaglutide', route: 'injection', frequency: 'weekly', unit: 'mg',
    doses: [0.25, 0.5, 1, 2], note: 'Licensed for type 2 diabetes; often used for weight.',
  },
  {
    id: 'wegovy', label: 'Wegovy', generic: 'semaglutide', route: 'injection', frequency: 'weekly', unit: 'mg',
    doses: [0.25, 0.5, 1, 1.7, 2.4], note: 'Licensed for weight management.',
  },
  {
    id: 'rybelsus', label: 'Rybelsus', generic: 'semaglutide (tablet)', route: 'oral', frequency: 'daily', unit: 'mg',
    doses: [3, 7, 14], note: 'Take on an empty stomach with a sip of water, then wait 30 minutes.',
  },
  {
    id: 'mounjaro', label: 'Mounjaro', generic: 'tirzepatide', route: 'injection', frequency: 'weekly', unit: 'mg',
    doses: [2.5, 5, 7.5, 10, 12.5, 15], note: 'GIP + GLP-1. Licensed for type 2 diabetes (weight in some countries).',
  },
  {
    id: 'zepbound', label: 'Zepbound', generic: 'tirzepatide', route: 'injection', frequency: 'weekly', unit: 'mg',
    doses: [2.5, 5, 7.5, 10, 12.5, 15], note: 'GIP + GLP-1. Licensed for weight management.',
  },
  {
    id: 'saxenda', label: 'Saxenda', generic: 'liraglutide', route: 'injection', frequency: 'daily', unit: 'mg',
    doses: [0.6, 1.2, 1.8, 2.4, 3], note: 'Daily. Steps up weekly to 3 mg.',
  },
  {
    id: 'victoza', label: 'Victoza', generic: 'liraglutide', route: 'injection', frequency: 'daily', unit: 'mg',
    doses: [0.6, 1.2, 1.8], note: 'Daily, for type 2 diabetes.',
  },
  {
    id: 'trulicity', label: 'Trulicity', generic: 'dulaglutide', route: 'injection', frequency: 'weekly', unit: 'mg',
    doses: [0.75, 1.5, 3, 4.5], note: 'Weekly, for type 2 diabetes.',
  },
  {
    id: 'byetta', label: 'Byetta', generic: 'exenatide', route: 'injection', frequency: 'twice_daily', unit: 'mcg',
    doses: [5, 10], note: 'Twice daily, within an hour before morning and evening meals.',
  },
  {
    id: 'bydureon', label: 'Bydureon BCise', generic: 'exenatide (extended release)', route: 'injection', frequency: 'weekly', unit: 'mg',
    doses: [2], note: 'Weekly.',
  },
  {
    id: 'other', label: 'Other GLP-1', generic: 'GLP-1 medicine', route: 'injection', frequency: 'weekly', unit: 'mg',
    doses: [], note: 'Type the name and dose your prescriber gave you.',
  },
]

export const MED_BY_ID = Object.fromEntries(GLP1_MEDS.map((m) => [m.id, m]))

export const FREQUENCY_LABEL = { weekly: 'Once a week', daily: 'Once a day', twice_daily: 'Twice a day' }

// Front view, as if someone is facing you: their left is on your right.
// Abdomen sites keep 5 cm (2 in) away from the navel.
export const INJECTION_SITES = [
  { id: 'abdomen-ul', label: 'Belly, upper left', short: 'Belly UL' },
  { id: 'abdomen-ur', label: 'Belly, upper right', short: 'Belly UR' },
  { id: 'abdomen-ll', label: 'Belly, lower left', short: 'Belly LL' },
  { id: 'abdomen-lr', label: 'Belly, lower right', short: 'Belly LR' },
  { id: 'thigh-l', label: 'Left thigh', short: 'L thigh' },
  { id: 'thigh-r', label: 'Right thigh', short: 'R thigh' },
  { id: 'arm-l', label: 'Left upper arm', short: 'L arm' },
  { id: 'arm-r', label: 'Right upper arm', short: 'R arm' },
]
export const SITE_BY_ID = Object.fromEntries(INJECTION_SITES.map((s) => [s.id, s]))

// Order the rotation suggestion walks through when sites tie.
export const ROTATION_ORDER = ['abdomen-ll', 'abdomen-lr', 'thigh-l', 'thigh-r', 'abdomen-ul', 'abdomen-ur', 'arm-l', 'arm-r']

export const MOODS = [
  { v: 1, emoji: '😣', label: 'Awful', color: 'var(--red)' },
  { v: 2, emoji: '😕', label: 'Low', color: 'var(--orange)' },
  { v: 3, emoji: '😐', label: 'Okay', color: 'var(--yellow)' },
  { v: 4, emoji: '🙂', label: 'Good', color: 'var(--green)' },
  { v: 5, emoji: '😄', label: 'Great', color: 'var(--mint)' },
]
export const MOOD_BY_V = Object.fromEntries(MOODS.map((m) => [m.v, m]))

export const ENERGY = [
  [1, 'Drained'],
  [2, 'Low'],
  [3, 'Okay'],
  [4, 'Good'],
  [5, 'Buzzing'],
]

// 3 is "normal"; GLP-1 users often sit at 1–2.
export const APPETITE = [
  [1, 'None'],
  [2, 'Low'],
  [3, 'Normal'],
  [4, 'Hungry'],
  [5, 'Starving'],
]

// `urgent` symptoms show a "get medical help" message.
export const SYMPTOMS = [
  { id: 'nausea', label: 'Nausea' },
  { id: 'vomiting', label: 'Vomiting' },
  { id: 'constipation', label: 'Constipation' },
  { id: 'diarrhoea', label: 'Diarrhoea' },
  { id: 'reflux', label: 'Heartburn' },
  { id: 'bloating', label: 'Bloating' },
  { id: 'fatigue', label: 'Tired' },
  { id: 'headache', label: 'Headache' },
  { id: 'dizzy', label: 'Dizzy' },
  { id: 'site', label: 'Injection-site reaction' },
  { id: 'severe_pain', label: 'Severe stomach pain', urgent: true },
  { id: 'cant_keep_fluids', label: 'Can’t keep fluids down', urgent: true },
]
export const SYMPTOM_BY_ID = Object.fromEntries(SYMPTOMS.map((s) => [s.id, s]))
