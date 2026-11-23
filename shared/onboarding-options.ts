import { DESTINATION_COUNTRIES, destinationCountryName } from "./institutional-destination";

export type SelectOption = { v: string; l: string };

export const ONBOARDING_COUNTRIES: SelectOption[] = DESTINATION_COUNTRIES
  .map((code) => ({ v: destinationCountryName(code), l: destinationCountryName(code) }))
  .filter((item, index, arr) => item.l && arr.findIndex((other) => other.l === item.l) === index)
  .sort((a, b) => a.l.localeCompare(b.l));

const NATIONALITIES_LIST = [
  "Afghan", "Albanian", "Algerian", "American", "Andorran", "Angolan", "Antiguan and Barbudan",
  "Argentine", "Armenian", "Australian", "Austrian", "Azerbaijani", "Bahamian", "Bahraini",
  "Bangladeshi", "Barbadian", "Belarusian", "Belgian", "Belizean", "Beninese", "Bermudian",
  "Bhutanese", "Bolivian", "Bosnian", "Botswanan", "Brazilian", "British", "Bruneian",
  "Bulgarian", "Burkinabe", "Burmese", "Burundian", "Cabo Verdean", "Cambodian", "Cameroonian",
  "Canadian", "Caymanian", "Central African", "Chadian", "Chilean", "Chinese", "Colombian",
  "Comoran", "Congolese", "Costa Rican", "Croatian", "Cuban", "Cypriot", "Czech", "Danish",
  "Djiboutian", "Dominican", "Dutch", "Ecuadorian", "Egyptian", "Emirati", "Equatorial Guinean",
  "Eritrean", "Estonian", "Eswatini", "Ethiopian", "Fijian", "Filipino", "Finnish", "French",
  "Gabonese", "Gambian", "Georgian", "German", "Ghanaian", "Gibraltarian", "Greek", "Grenadian",
  "Guatemalan", "Guinean", "Guyanese", "Haitian", "Honduran", "Hong Konger", "Hungarian",
  "Icelandic", "Indian", "Indonesian", "Iranian", "Iraqi", "Irish", "Israeli", "Italian",
  "Ivorian", "Jamaican", "Japanese", "Jordanian", "Kazakh", "Kenyan", "Kuwaiti", "Kyrgyz",
  "Laotian", "Latvian", "Lebanese", "Liberian", "Libyan", "Liechtensteiner", "Lithuanian",
  "Luxembourger", "Macanese", "Macedonian", "Malagasy", "Malawian", "Malaysian", "Maldivian",
  "Malian", "Maltese", "Mauritanian", "Mauritian", "Mexican", "Moldovan", "Monacan", "Mongolian",
  "Montenegrin", "Moroccan", "Mozambican", "Namibian", "Nepalese", "New Zealander", "Nicaraguan",
  "Nigerian", "Nigerien", "Norwegian", "Omani", "Pakistani", "Palauan", "Palestinian", "Panamanian",
  "Papua New Guinean", "Paraguayan", "Peruvian", "Polish", "Portuguese", "Qatari", "Romanian",
  "Russian", "Rwandan", "Saint Lucian", "Salvadoran", "Samoan", "San Marinese", "Saudi Arabian",
  "Scottish", "Senegalese", "Serbian", "Seychellois", "Sierra Leonean", "Singaporean", "Slovak",
  "Slovenian", "Somali", "South African", "South Korean", "Spanish", "Sri Lankan", "Sudanese",
  "Surinamese", "Swedish", "Swiss", "Syrian", "Taiwanese", "Tajik", "Tanzanian", "Thai",
  "Togolese", "Tongan", "Trinidadian and Tobagonian", "Tunisian", "Turkish", "Turkmen",
  "Ugandan", "Ukrainian", "Uruguayan", "Uzbek", "Venezuelan", "Vietnamese", "Welsh",
  "Yemeni", "Zambian", "Zimbabwean", "Dual / Multiple Nationalities",
];

export const ONBOARDING_NATIONALITIES: SelectOption[] = NATIONALITIES_LIST.map((n) => ({ v: n, l: n }));

export const EMPLOYMENT_STATUS_OPTIONS: SelectOption[] = [
  { v: "employed", l: "Employed full time" },
  { v: "part-time", l: "Employed part time" },
  { v: "self-employed", l: "Self employed or business owner" },
  { v: "retired", l: "Retired" },
  { v: "student", l: "Student" },
  { v: "unemployed", l: "Not currently employed" },
];

export const ANNUAL_INCOME_OPTIONS: SelectOption[] = [
  { v: "under-50k", l: "Under $50,000" },
  { v: "50k-100k", l: "$50,000 – $100,000" },
  { v: "100k-250k", l: "$100,000 – $250,000" },
  { v: "250k-500k", l: "$250,000 – $500,000" },
  { v: "500k-1m", l: "$500,000 – $1,000,000" },
  { v: "over-1m", l: "Over $1,000,000" },
];

export const INVESTMENT_EXPERIENCE_OPTIONS: SelectOption[] = [
  { v: "none", l: "Brand new to investing" },
  { v: "beginner", l: "Basic familiarity" },
  { v: "intermediate", l: "Some portfolio experience" },
  { v: "experienced", l: "Actively managed portfolios" },
  { v: "professional", l: "Financial industry background" },
];

export const RISK_TOLERANCE_OPTIONS: SelectOption[] = [
  { v: "conservative", l: "Conservative, preserve capital" },
  { v: "moderate", l: "Moderate, balanced approach" },
  { v: "growth", l: "Growth, long-term appreciation" },
  { v: "aggressive", l: "Aggressive, maximum growth" },
];

export const INVESTMENT_GOAL_OPTIONS: SelectOption[] = [
  { v: "retirement", l: "Retirement planning" },
  { v: "growth", l: "Long term capital growth" },
  { v: "income", l: "Income and dividends" },
  { v: "preservation", l: "Capital preservation" },
  { v: "education", l: "Education funding" },
  { v: "estate", l: "Estate and legacy planning" },
];

export const INITIAL_DEPOSIT_OPTIONS: SelectOption[] = [
  { v: "under-5k", l: "Under $5,000" },
  { v: "5k-25k", l: "$5,000 – $25,000" },
  { v: "25k-100k", l: "$25,000 – $100,000" },
  { v: "100k-500k", l: "$100,000 – $500,000" },
  { v: "500k-1m", l: "$500,000 – $1,000,000" },
  { v: "over-1m", l: "Over $1,000,000" },
  { v: "custom", l: "Other / Custom amount" },
];

export const SOURCE_OF_FUNDS_OPTIONS: SelectOption[] = [
  { v: "salary", l: "Employment or salary" },
  { v: "business", l: "Business income or exit" },
  { v: "inheritance", l: "Inheritance or gift" },
  { v: "savings", l: "Personal savings" },
  { v: "investment", l: "Investment returns" },
  { v: "other", l: "Other" },
];

const LABEL_MAP: Record<string, string> = Object.fromEntries([
  ...EMPLOYMENT_STATUS_OPTIONS,
  ...ANNUAL_INCOME_OPTIONS,
  ...INVESTMENT_EXPERIENCE_OPTIONS,
  ...RISK_TOLERANCE_OPTIONS,
  ...INVESTMENT_GOAL_OPTIONS,
  ...INITIAL_DEPOSIT_OPTIONS,
  ...SOURCE_OF_FUNDS_OPTIONS,
  // Legacy onboarding values for readable display of older records
  { v: "under-50m", l: "Under $50,000,000" },
  { v: "50m-100m", l: "$50,000,000 – $100,000,000" },
  { v: "100m-500m", l: "$100,000,000 – $500,000,000" },
  { v: "500m-1b", l: "$500,000,000 – $1,000,000,000" },
  { v: "over-1b", l: "Over $1,000,000,000" },
  { v: "1b-5b", l: "$1B – $5B" },
  { v: "5b-10b", l: "$5B – $10B" },
  { v: "over-10b", l: "Over $10B" },
].map((o) => [o.v, o.l]));

export function formatOnboardingLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (LABEL_MAP[value]) return LABEL_MAP[value];
  return String(value).replace(/-/g, " ");
}
