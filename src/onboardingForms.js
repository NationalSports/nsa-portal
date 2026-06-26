/* eslint-disable */
// Shared content + structure for the new-hire onboarding wizard.
// The California notice text below is plain-language summary + official pamphlet
// references so the hire can acknowledge receipt. These are NOT a substitute for
// distributing the official state pamphlets/PDFs — HR should confirm wording with
// counsel and attach the official documents where required.

// Roles offered in the staff "create invite" screen (mirrors the portal roles).
export const ONBOARDING_ROLES = [
  { key: 'rep', label: 'Sales Rep' },
  { key: 'csr', label: 'Customer Service (CSR)' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'production', label: 'Production' },
  { key: 'prod_assistant', label: 'Production Assistant' },
  { key: 'prod_manager', label: 'Production Manager' },
  { key: 'artist', label: 'Artist / Decorator' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'gm', label: 'General Manager' },
  { key: 'admin', label: 'Admin' },
];

export const EMPLOYMENT_TYPES = [
  { key: 'w2_employee', label: 'W-2 Employee' },
  { key: 'contractor_1099', label: 'Contracted 1099' },
];

export const PAY_TYPES = [
  { key: 'hourly', label: 'Hourly' },
  { key: 'salary', label: 'Salary' },
  { key: 'draw_commission', label: 'Draw + Commission' },
];

// California new-hire notices. `key` matches the acknowledgments keys the wizard
// and the packet PDF use (ca:<...>).
export const CA_NOTICES = [
  {
    key: 'ca:wage_theft',
    title: 'Wage Theft Prevention Notice (Labor Code § 2810.5)',
    body: `<p>California requires that non-exempt employees receive, at the time of hire, written notice of: your rate(s) of pay and basis (hourly, salary, commission, etc.); allowances claimed as part of the minimum wage; the regular payday; the employer's legal name, address, and phone; and the workers' compensation carrier.</p>
    <p>Your specific pay rate, payday, and employer information are shown in your offer and on your Job Hire Form in this packet. If any of those details are unclear, ask before signing.</p>`,
  },
  {
    key: 'ca:workers_comp',
    title: "Workers' Compensation — Rights & Treating Physician",
    body: `<p>You are covered by workers' compensation insurance for work-related injuries and illnesses, at no cost to you. If you are injured on the job, report it to your supervisor immediately so a claim form (DWC-1) can be provided within one working day.</p>
    <p>You have the right to <strong>predesignate your personal physician</strong> to treat you for a work injury, but only if you do so in writing before the injury and your physician agrees in advance. Ask HR for the predesignation form if you wish to do this.</p>`,
  },
  {
    key: 'ca:sdi',
    title: 'State Disability Insurance (DE 2515)',
    body: `<p>State Disability Insurance (SDI) provides partial wage replacement if you can't work due to a non-work-related illness, injury, or pregnancy. It is funded by deductions from your paycheck. The official EDD pamphlet "Disability Insurance Provisions" (DE 2515) describes eligibility and how to file a claim.</p>`,
  },
  {
    key: 'ca:pfl',
    title: 'Paid Family Leave (DE 2511)',
    body: `<p>Paid Family Leave (PFL) provides up to eight weeks of partial wage replacement to bond with a new child or care for a seriously ill family member, and for certain military-related events. It is also funded through SDI deductions. See the EDD pamphlet "Paid Family Leave" (DE 2511) for details.</p>`,
  },
  {
    key: 'ca:harassment',
    title: 'Sexual Harassment Is Prohibited (DFEH/CRD-185)',
    body: `<p>National Sports Apparel prohibits harassment, discrimination, and retaliation. California's Civil Rights Department pamphlet "Sexual Harassment and Discrimination Is Prohibited by Law" (DFEH/CRD-185) explains what constitutes unlawful harassment, your protections, and how to file a complaint. You may report concerns to your supervisor or the Controller without fear of retaliation. (Required harassment-prevention training will be assigned within your first six months.)</p>`,
  },
  {
    key: 'ca:sick_leave',
    title: 'Paid Sick Leave Notice',
    body: `<p>Under California's Healthy Workplaces, Healthy Families Act, you accrue paid sick leave and may begin using it as provided by law and the company's policy (see the Paid Sick Leave section of the handbook). Sick leave may be used for your own or a family member's health, and for certain safe-time reasons. You are protected from retaliation for using paid sick leave.</p>`,
  },
  {
    key: 'ca:de35',
    title: 'Notice to Employee (DE 35)',
    body: `<p>The EDD "Notice to Employees" (DE 35) informs you about Unemployment Insurance, State Disability Insurance, Paid Family Leave, and the federal/California Earned Income Tax Credit (EITC) you may be eligible to claim.</p>`,
  },
  {
    key: 'ca:dv_rights',
    title: 'Victims of Violence — Rights Notice',
    body: `<p>California law protects employees who are victims of domestic violence, sexual assault, stalking, or other crimes. You have the right to take time off for related medical, legal, or safety reasons, and to request reasonable safety accommodations, without retaliation. Notify HR if you need to exercise these rights.</p>`,
  },
  {
    key: 'ca:workplace_violence',
    title: 'Workplace Violence Prevention (SB 553)',
    body: `<p>National Sports Apparel maintains a Workplace Violence Prevention Plan as required by California Labor Code § 6401.9. The plan covers how to report workplace-violence concerns or incidents without retaliation, how incidents are investigated, and the training you will receive. Ask HR for a copy of the full written plan.</p>`,
  },
  {
    key: 'ca:calsavers',
    title: 'CalSavers Retirement Savings',
    body: `<p>If the company does not offer a qualified retirement plan, California's CalSavers program lets you save for retirement through automatic payroll contributions to a Roth IRA. Participation is voluntary — you may opt out at any time. You'll receive enrollment information from the CalSavers program if applicable.</p>`,
  },
];

// At-will + handbook acknowledgment statement shown on the handbook step.
export const AT_WILL_STATEMENT =
  'I acknowledge that I have received, read, and understand the National Sports Apparel, LLC Employee Handbook (2025). I understand that my employment is "at-will," meaning either I or the Company may end the employment relationship at any time, with or without cause or notice, and that nothing in the handbook creates a contract or promise of continued employment.';

// Wizard step ids in order (drives progress + the staff tracking view).
export const WIZARD_STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'personal', label: 'Personal Info' },
  { id: 'direct_deposit', label: 'Direct Deposit' },
  { id: 'emergency', label: 'Emergency Contacts' },
  { id: 'tax', label: 'Tax Forms (W-4 / DE 4)' },
  { id: 'commission', label: 'Commission Agreement' }, // shown only if commission_eligible
  { id: 'handbook', label: 'Employee Handbook' },
  { id: 'ca_notices', label: 'California Notices' },
  { id: 'review', label: 'Review & Submit' },
];

export const FILING_STATUSES = ['Single or Married filing separately', 'Married filing jointly', 'Head of Household'];
export const ACCOUNT_TYPES = ['Checking', 'Savings'];
