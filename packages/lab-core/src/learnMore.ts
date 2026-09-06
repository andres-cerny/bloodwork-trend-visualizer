/**
 * "O parametru": where a reader can learn what a parameter measures.
 *
 * The app shows numbers and says whether they are inside the printed range.
 * It does not say what creatinine *is*, and it should not start: explaining
 * a test to a patient is editorial work with a medical guarantor behind it.
 * Lab Tests Online CZ (labtestsonline.cz) is that — the Czech edition of the
 * international patient-education project, run and content-guaranteed by the
 * Czech Society of Clinical Biochemistry and the resource the state health
 * portal NZIP sends patients to. So the app links out rather than explaining.
 *
 * The map is curated by hand because their slugs are not derivable from ours:
 * urea is "mocovina", LDH is "ld", hořčík is "magnezium", CRP is
 * "c-reaktivni-protein". Where one page explains a whole panel — the lipid
 * profile for triglycerides, the differential for each white-cell fraction —
 * the panel page is linked. Where no page clearly explains the parameter, the
 * id is absent and the UI shows nothing: a link to the wrong article is worse
 * than no link, and a link to a search box is a shrug dressed as help.
 *
 * Their terms permit linking and forbid reproducing the text, which is the
 * other reason this is a URL and not a paragraph.
 *
 * `tools/scripts/check-learn-more.mjs` proves every slug still resolves;
 * `tests/learnMore.test.ts` proves every key is a parameter the app can show.
 */

export const LEARN_MORE_BASE = "https://www.labtestsonline.cz/";

/** canonicalId → labtestsonline.cz slug (the part before ".html"). */
export const LEARN_MORE_SLUGS: Readonly<Record<string, string>> = {
  // Biochemistry
  glukoza: "glukoza",
  urea: "mocovina",
  kreatinin: "kreatinin",
  egfr: "kreatinin",
  egfr_mdrd: "kreatinin",
  kyselina_mocova: "kyselina-mocova",
  bilirubin_celkovy: "bilirubin",
  bilirubin_konjugovany: "bilirubin",
  ast: "ast",
  alt: "alt",
  alp: "alp",
  alp_kostni: "kostni-markery",
  ggt: "ggt",
  ldh: "ld",
  ck: "ck",
  ck_mb: "ck-mb",
  myoglobin: "myoglobin",
  troponin_i: "troponin",
  nt_probnp: "bnp-a-nt-probnp",
  celkova_bilkovina: "celkova-bilkovina-a-pomer-albuminglobuliny-ag",
  albumin: "albumin",
  crp: "c-reaktivni-protein",
  homocystein: "homocystein",
  osmolalita: "osmolalita",

  // Minerals
  sodik: "sodik",
  draslik: "draslik",
  chloridy: "chloridy",
  vapnik: "vapnik",
  vapnik_ionizovany: "vapnik",
  horcik: "magnezium",
  fosfor: "fosfor",

  // Lipids
  cholesterol: "cholesterol",
  hdl: "hdl-cholesterol",
  ldl: "ldl-cholesterol",
  non_hdl: "lipidovy-profil",
  triacylglyceroly: "lipidovy-profil",
  "derived:non_hdl": "lipidovy-profil",
  "derived:ldl_friedewald": "ldl-cholesterol",

  // Iron and vitamins
  zelezo: "zelezo-v-seru",
  ferritin: "feritin",
  transferrin: "transferin-a-vazebna-kapacita-sera-pro-zelezo",
  vk_fe_volna: "transferin-a-vazebna-kapacita-sera-pro-zelezo",
  vk_fe_celkova: "transferin-a-vazebna-kapacita-sera-pro-zelezo",
  saturace_trf: "transferin-a-vazebna-kapacita-sera-pro-zelezo",
  vitamin_b12: "vitamin-b12-a-kyselina-listova",
  kyselina_listova: "vitamin-b12-a-kyselina-listova",
  mma: "kyselina-metylmalonova",
  vitamin_d: "vitamin-d",

  // Hormones
  tsh: "tsh",
  ft4: "t4",
  ft3: "t3",
  fsh: "fsh",
  lh: "lh",
  estradiol: "estrogeny",
  progesteron: "progesteron",
  testosteron: "testosteron",
  testosteron_volny: "testosteron",
  shbg: "shbg",
  dhea_s: "dheas",
  kortizol: "kortizol",
  igf1: "igf-1",
  inzulin: "inzulin",
  c_peptid: "c-peptid",
  erytropoetin: "erytropoetin",
  osteokalcin: "kostni-markery",

  // Immunology
  iga: "imunoglobuliny-kvantitativne",
  igg: "imunoglobuliny-kvantitativne",
  igm: "imunoglobuliny-kvantitativne",
  ige: "alergie-testovani",
  c3: "komplement",
  c4: "komplement",

  // Blood count
  leukocyty: "leukocyty",
  erytrocyty: "erytrocyty",
  hemoglobin: "hemoglobin",
  hematokrit: "hematokrit",
  mcv: "mcv",
  mch: "mcv-mch-mchc-a-rdw",
  mchc: "mchc",
  rdw: "rdw",
  trombocyty: "trombocyty",
  mpv: "trombocyty",
  retikulocyty: "retikulocyty",
  retikulocyty_abs: "retikulocyty",
  neutrofily: "diferencialni-rozpocet-leukocytu",
  lymfocyty: "diferencialni-rozpocet-leukocytu",
  monocyty: "diferencialni-rozpocet-leukocytu",
  eosinofily: "diferencialni-rozpocet-leukocytu",
  basofily: "diferencialni-rozpocet-leukocytu",
  neutrofily_abs: "diferencialni-rozpocet-leukocytu",
  lymfocyty_abs: "diferencialni-rozpocet-leukocytu",
  monocyty_abs: "diferencialni-rozpocet-leukocytu",
  eosinofily_abs: "diferencialni-rozpocet-leukocytu",
  basofily_abs: "diferencialni-rozpocet-leukocytu",
  fw: "sedimentace-erytrocytu",
};

/**
 * The page explaining a parameter, or undefined when none is known to.
 *
 * Deliberately absent, so the header shows no link: the sample-quality
 * indices (hemolýza, ikterita, chylóza), which describe the tube rather than
 * the patient; lab-internal ratios (FAI, index aterogenity, AST/ALT); and the
 * parameters the site has no article for — ACP, PIIINP, ECP, zinek, PDW,
 * trombokrit, active B12, folate in erythrocytes, soluble transferrin
 * receptor, corrected calcium, the reticulocyte index.
 */
export function learnMoreUrl(canonicalId: string): string | undefined {
  const slug = LEARN_MORE_SLUGS[canonicalId];
  return slug ? `${LEARN_MORE_BASE}${slug}.html` : undefined;
}
