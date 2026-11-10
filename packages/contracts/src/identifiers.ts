import { z } from "@hono/zod-openapi";

/** GS1 mod-10 check digit over all digits but the last. */
export const gs1CheckDigitValid = (digits: string): boolean => {
  if (!/^\d+$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
};

export const Gtin = z
  .string()
  .trim()
  .regex(/^(\d{8}|\d{12}|\d{13}|\d{14})$/, "GTIN must have 8, 12, 13 or 14 digits")
  .refine(gs1CheckDigitValid, "GTIN check digit is wrong")
  .openapi({ example: "8001234567893" });

export const Gln = z
  .string()
  .trim()
  .regex(/^\d{13}$/, "GLN must have 13 digits")
  .refine(gs1CheckDigitValid, "GLN check digit is wrong")
  .openapi({ example: "8001234000002" });

// ISO 3166-1 alpha-2 (officially assigned codes).
const ISO_COUNTRIES = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
    "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
    "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
    "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
    "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

export const CountryCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => ISO_COUNTRIES.has(s), "Use an ISO 3166-1 two-letter country code, e.g. IT")
  .openapi({ example: "IT" });
