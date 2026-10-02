export const ACCESS_EMAIL = "access@ashutosh-pandey.com";

const BODY = ["Who you are:", "", "What you'd like to try:", "", "Roughly how many times:", ""].join("\n");

/** encodeURIComponent, not URLSearchParams: the latter writes spaces as "+",
 * which several mail clients show literally in a mailto subject. */
export function requestAccessHref(subject: string): string {
  return `mailto:${ACCESS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(BODY)}`;
}
