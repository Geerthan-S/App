/**
 * Sample content for the client-review demo workspace.
 *
 * Every sample record carries `isDemo: true` and an id starting with `demo_`,
 * so the whole set can be found and removed (clearDemoWorkspace). Names are
 * fictional; registration numbers start with DEMO so they can never match a
 * real register.
 */

export const DEMO_PREFIX = 'demo_';
export const isDemoId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(DEMO_PREFIX);

export interface DemoOrg {
  id: string;
  legalName: string;
  displayName: string;
  organizationType: 'hospital' | 'clinic' | 'nursing_home';
  registrationNumber: string;
  address: string;
  city: string;
  facility: { id: string; name: string; address: string };
}

export const DEMO_ORGS: DemoOrg[] = [
  {
    id: 'demo_org_meridian', legalName: 'Meridian Care Hospitals Pvt Ltd', displayName: 'Meridian Care Hospital',
    organizationType: 'hospital', registrationNumber: 'DEMO-TN-CE-1041', address: '14 Greams Lane, Thousand Lights', city: 'Chennai',
    facility: { id: 'demo_fac_meridian', name: 'Meridian Care Hospital, Main Campus', address: '14 Greams Lane, Thousand Lights' },
  },
  {
    id: 'demo_org_lakeview', legalName: 'Lakeview Multispeciality Hospital LLP', displayName: 'Lakeview Multispeciality',
    organizationType: 'hospital', registrationNumber: 'DEMO-KA-CE-2207', address: '88 Outer Ring Road, Bellandur', city: 'Bengaluru',
    facility: { id: 'demo_fac_lakeview', name: 'Lakeview Multispeciality, Bellandur', address: '88 Outer Ring Road, Bellandur' },
  },
  {
    id: 'demo_org_stanne', legalName: "St. Anne's Medical Centre Trust", displayName: "St. Anne's Medical Centre",
    organizationType: 'hospital', registrationNumber: 'DEMO-KL-CE-0318', address: '2 Church Road, Ernakulam North', city: 'Kochi',
    facility: { id: 'demo_fac_stanne', name: "St. Anne's Medical Centre", address: '2 Church Road, Ernakulam North' },
  },
  {
    id: 'demo_org_riverside', legalName: "Riverside Children's Hospital Pvt Ltd", displayName: "Riverside Children's Hospital",
    organizationType: 'hospital', registrationNumber: 'DEMO-TS-CE-5560', address: '5 Road No. 2, Banjara Hills', city: 'Hyderabad',
    facility: { id: 'demo_fac_riverside', name: "Riverside Children's Hospital", address: '5 Road No. 2, Banjara Hills' },
  },
];

export interface DemoDoctor {
  id: string;
  fullName: string;
  primarySpecialty: string;
  qualification: string;
  yearsOfExperience: number;
  council: string;
  registrationNo: string;
  city: string;
  bio: string;
}

export const DEMO_DOCTORS: DemoDoctor[] = [
  { id: 'demo_doc_kavya', fullName: 'Dr. Kavya Iyer', primarySpecialty: 'Emergency Medicine', qualification: 'MBBS, MD (Emergency Medicine)', yearsOfExperience: 6, council: 'Tamil Nadu Medical Council', registrationNo: 'DEMO-TN-48213', city: 'Chennai', bio: 'Emergency physician; comfortable leading resuscitation and night casualty shifts.' },
  { id: 'demo_doc_arjun', fullName: 'Dr. Arjun Mehta', primarySpecialty: 'Anaesthesiology', qualification: 'MBBS, DA, DNB (Anaesthesiology)', yearsOfExperience: 9, council: 'Karnataka Medical Council', registrationNo: 'DEMO-KA-77120', city: 'Bengaluru', bio: 'Consultant anaesthetist; regional blocks, day-care and emergency OT lists.' },
  { id: 'demo_doc_fatima', fullName: 'Dr. Fatima Khan', primarySpecialty: 'Pediatrics', qualification: 'MBBS, DCH', yearsOfExperience: 4, council: 'Telangana State Medical Council', registrationNo: 'DEMO-TS-30944', city: 'Hyderabad', bio: 'Paediatrician with NICU step-down experience; available for weekend cover.' },
  { id: 'demo_doc_rohan', fullName: 'Dr. Rohan Das', primarySpecialty: 'General Medicine', qualification: 'MBBS', yearsOfExperience: 3, council: 'National Medical Commission (NMC)', registrationNo: 'DEMO-NMC-61502', city: 'Kochi', bio: 'Duty medical officer for wards and OPD; flexible across day and night shifts.' },
];

export interface DemoDutyTemplate {
  key: string;
  orgId: string;
  specialtyId: string;
  specialtyName: string;
  department: string;
  qualificationRequired: string;
  experienceMinYears: number;
  shiftType: 'morning' | 'evening' | 'night' | 'full_day';
  /** Days from today and local (IST) start hour. */
  dayOffset: number;
  startHourIst: number;
  hours: number;
  amount: number;
  basis: 'per_shift' | 'per_hour';
  headcount: number;
  notes: string;
}

export const DEMO_DUTIES: DemoDutyTemplate[] = [
  { key: 'meridian_er_night', orgId: 'demo_org_meridian', specialtyId: 'emergency_medicine', specialtyName: 'Emergency Medicine', department: 'Casualty', qualificationRequired: 'MBBS', experienceMinYears: 2, shiftType: 'night', dayOffset: 1, startHourIst: 20, hours: 12, amount: 6500, basis: 'per_shift', headcount: 2, notes: 'Busy casualty; triage nurse and senior resident on site.' },
  { key: 'meridian_icu_day', orgId: 'demo_org_meridian', specialtyId: 'critical_care', specialtyName: 'Critical Care', department: 'Medical ICU', qualificationRequired: 'MBBS, MD/DNB', experienceMinYears: 3, shiftType: 'full_day', dayOffset: 3, startHourIst: 8, hours: 12, amount: 9000, basis: 'per_shift', headcount: 1, notes: '12-bed MICU, ventilated patients; intensivist reachable on call.' },
  { key: 'lakeview_anaes_ot', orgId: 'demo_org_lakeview', specialtyId: 'anaesthesiology', specialtyName: 'Anaesthesiology', department: 'Operation Theatre', qualificationRequired: 'MBBS, DA/MD', experienceMinYears: 3, shiftType: 'morning', dayOffset: 2, startHourIst: 7, hours: 8, amount: 1400, basis: 'per_hour', headcount: 1, notes: 'Elective orthopaedic list, 5 cases expected.' },
  { key: 'lakeview_gm_ward', orgId: 'demo_org_lakeview', specialtyId: 'general_medicine', specialtyName: 'General Medicine', department: 'Inpatient Ward', qualificationRequired: 'MBBS', experienceMinYears: 1, shiftType: 'evening', dayOffset: 4, startHourIst: 14, hours: 8, amount: 4000, basis: 'per_shift', headcount: 2, notes: 'Ward rounds handover at 2 PM; 30 beds.' },
  { key: 'stanne_obg_night', orgId: 'demo_org_stanne', specialtyId: 'obstetrics_gynecology', specialtyName: 'Obstetrics & Gynaecology', department: 'Labour Room', qualificationRequired: 'MBBS, MS/DGO', experienceMinYears: 2, shiftType: 'night', dayOffset: 5, startHourIst: 20, hours: 12, amount: 8000, basis: 'per_shift', headcount: 1, notes: 'Level II labour room; consultant on call.' },
  { key: 'stanne_opd_morning', orgId: 'demo_org_stanne', specialtyId: 'general_medicine', specialtyName: 'General Medicine', department: 'Outpatient (OPD)', qualificationRequired: 'MBBS', experienceMinYears: 0, shiftType: 'morning', dayOffset: 6, startHourIst: 9, hours: 6, amount: 3500, basis: 'per_shift', headcount: 1, notes: 'Approximately 40 OPD patients.' },
  { key: 'riverside_peds_weekend', orgId: 'demo_org_riverside', specialtyId: 'pediatrics', specialtyName: 'Pediatrics', department: 'Paediatric Ward', qualificationRequired: 'MBBS, DCH/MD', experienceMinYears: 2, shiftType: 'full_day', dayOffset: 7, startHourIst: 8, hours: 12, amount: 7500, basis: 'per_shift', headcount: 2, notes: 'Weekend cover; NICU step-down attached.' },
  { key: 'riverside_er_evening', orgId: 'demo_org_riverside', specialtyId: 'emergency_medicine', specialtyName: 'Emergency Medicine', department: 'Paediatric Emergency', qualificationRequired: 'MBBS', experienceMinYears: 1, shiftType: 'evening', dayOffset: 9, startHourIst: 16, hours: 8, amount: 5000, basis: 'per_shift', headcount: 1, notes: 'Paediatric ER, PALS certification preferred.' },
];

export const DEMO_ORG_REVIEWS: { orgId: string; doctorId: string; rating: number; comment: string; daysAgo: number }[] = [
  { orgId: 'demo_org_meridian', doctorId: 'demo_doc_kavya', rating: 5, comment: 'Well-run casualty, quick handover and payment arrived the same evening.', daysAgo: 6 },
  { orgId: 'demo_org_meridian', doctorId: 'demo_doc_rohan', rating: 4, comment: 'Supportive nursing team. Parking was a little hard to find.', daysAgo: 13 },
  { orgId: 'demo_org_lakeview', doctorId: 'demo_doc_arjun', rating: 5, comment: 'OT list started on time and the anaesthesia workstation was well maintained.', daysAgo: 4 },
  { orgId: 'demo_org_stanne', doctorId: 'demo_doc_fatima', rating: 4, comment: 'Calm night shift, clear escalation pathway to the consultant.', daysAgo: 9 },
  { orgId: 'demo_org_riverside', doctorId: 'demo_doc_fatima', rating: 5, comment: 'Excellent paediatric team and clean, well-stocked wards.', daysAgo: 2 },
];

/** A scripted thread: [side that speaks, text, minutes before now]. */
export type ScriptLine = ['doctor' | 'organization', string, number];

/** Threads a new doctor sees, one per sample hospital. */
export const DOCTOR_SIDE_THREADS: { orgId: string; dutyKey: string; unread: number; lines: ScriptLine[] }[] = [
  { orgId: 'demo_org_meridian', dutyKey: 'meridian_er_night', unread: 2, lines: [
    ['organization', 'Hi Doctor, thanks for your interest in the casualty night shift.', 190],
    ['doctor', 'Happy to help. Is there a senior resident on site overnight?', 180],
    ['organization', 'Yes, a senior resident and two triage nurses are on every night.', 45],
    ['organization', 'Could you report by 7:45 PM for a short handover?', 44],
  ] },
  { orgId: 'demo_org_lakeview', dutyKey: 'lakeview_anaes_ot', unread: 1, lines: [
    ['doctor', 'Good morning. Which theatre is the orthopaedic list in?', 1500],
    ['organization', 'OT 3 on the second floor. The list starts at 7:30 AM.', 1460],
    ['organization', 'Breakfast is arranged in the doctors\' lounge after the first case.', 300],
  ] },
  { orgId: 'demo_org_stanne', dutyKey: 'stanne_obg_night', unread: 0, lines: [
    ['organization', 'We received your application for the labour-room night shift.', 2900],
    ['doctor', 'Thank you. Is there an anaesthetist available for emergency LSCS?', 2880],
    ['organization', 'Yes, an anaesthetist is on call within 15 minutes.', 2870],
    ['doctor', 'Perfect, see you on the night of the shift.', 2860],
  ] },
  { orgId: 'demo_org_riverside', dutyKey: 'riverside_peds_weekend', unread: 1, lines: [
    ['organization', 'Hello! Our weekend paediatric cover is still open if you are available.', 4400],
    ['doctor', 'I can do Saturday. What time should I arrive?', 4300],
    ['organization', 'Please come by 7:45 AM. We will share the ward census on arrival.', 120],
  ] },
];

/** Threads a new hospital sees, one per sample doctor. */
export const HOSPITAL_SIDE_THREADS: { doctorId: string; unread: number; lines: ScriptLine[] }[] = [
  { doctorId: 'demo_doc_kavya', unread: 2, lines: [
    ['doctor', 'Hello, I applied for your night casualty shift. Is parking available on site?', 95],
    ['organization', 'Hi Dr. Iyer, yes, staff parking is behind the main block.', 80],
    ['doctor', 'Great. I can also extend by two hours if the ER is busy.', 30],
    ['doctor', 'Please let me know if you need my registration certificate again.', 29],
  ] },
  { doctorId: 'demo_doc_arjun', unread: 1, lines: [
    ['doctor', 'Good evening. Could you share the expected case list for the OT shift?', 700],
    ['organization', 'Sure, it is mainly laparoscopic general surgery, about five cases.', 650],
    ['doctor', 'Thanks. I will bring my own nerve-block needles if that helps.', 240],
  ] },
  { doctorId: 'demo_doc_fatima', unread: 0, lines: [
    ['organization', 'Dr. Khan, thank you for covering last weekend. Feedback was excellent.', 3000],
    ['doctor', 'Thank you! I am available again next month as well.', 2950],
  ] },
  { doctorId: 'demo_doc_rohan', unread: 1, lines: [
    ['doctor', 'Hi, is the OPD shift still open? I have experience with high-volume OPDs.', 1800],
    ['organization', 'Yes, it is open. Please apply from the duty page and we will confirm.', 1750],
    ['doctor', 'Done, I have applied. Looking forward to it.', 60],
  ] },
];

const DOCTOR_REPLIES = [
  'Thanks for the update, that works for me.',
  'Noted. I will be there 15 minutes early for handover.',
  'Sounds good. Is there anything I should bring?',
  'Thank you! Please share the ward contact number when you can.',
];

const HOSPITAL_REPLIES = [
  'Thank you, Doctor. Our duty manager will confirm the details shortly.',
  'Noted. The nursing in-charge will meet you at the front desk.',
  'Thanks for letting us know. We have updated the roster.',
  'Great, see you on the day of the shift.',
];

/** The automatic reply from the sample side of a thread. */
export const demoReplyFor = (replySide: 'doctor' | 'organization', messageCount: number): string => {
  const list = replySide === 'doctor' ? DOCTOR_REPLIES : HOSPITAL_REPLIES;
  return list[Math.abs(messageCount) % list.length];
};

/** IST start time for a template, as an ISO string. */
export const demoScheduleOf = (template: { dayOffset: number; startHourIst: number; hours: number }, nowMs = Date.now()) => {
  const istNow = new Date(nowMs + 330 * 60_000);
  const startUtcMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + template.dayOffset,
    template.startHourIst, 0, 0) - 330 * 60_000;
  return {
    startAt: new Date(startUtcMs).toISOString(),
    endAt: new Date(startUtcMs + template.hours * 3_600_000).toISOString(),
  };
};
