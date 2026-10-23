/**
 * Official registers trusted when no super admin has saved a list yet
 * (configuration/approved_registry_domains). Without a default, a fresh project
 * could approve nothing. Super admins replace this in Admin › Medical Councils.
 */
export const DEFAULT_REGISTRY_DOMAINS = [
  'www.nmc.org.in',                       // National Medical Commission: Indian Medical Register (doctors)
  'nmc.org.in',
  'clinicalestablishments.gov.in',        // National Register of Clinical Establishments (hospitals)
  'www.clinicalestablishments.gov.in',
];

/** The saved list, or the defaults when none has been saved. */
export const registryDomainsOf = (data: { value?: unknown } | undefined): string[] =>
  Array.isArray(data?.value) && data!.value.length ? (data!.value as string[]) : DEFAULT_REGISTRY_DOMAINS;
