// Local-mode bootstrap. Without a cloud database SIMBLIP still runs fully
// offline in this browser; the only seeded account is the platform operator,
// who provisions real institutions and people from the /dev console. There is
// no sample tenant — every institution on the platform is one you created.

import type { Institution, Profile } from './types'

/** The colour the admin console's brand picker OPENS on — a placeholder, not
 *  a choice anyone made. It was also being written into every institution row
 *  as `accent_color`, and AccentApplier ranks a brand colour ABOVE the theme's
 *  own accent, so every tenant silently pinned the whole UI to blue and no
 *  App Theme's accent could ever show. Treated as "no brand set". */
export const UNSET_BRAND_ACCENT = '#3b82f6'

export const PLATFORM_TENANT: Institution = {
  id: 'inst-platform',
  name: 'SIMBLIP Platform',
  slug: 'simblip-platform',
  accentColor: null,
  logoUrl: null,
}

export interface SeedAccount extends Profile {
  password: string
}

export const OPERATOR_ACCOUNT: SeedAccount = {
  id: 'user-operator',
  institutionId: PLATFORM_TENANT.id,
  role: 'super_admin',
  fullName: 'SIMBLIP Operator',
  email: 'aalubhentakobhi@simblip.dev',
  password: 'loonivaislobhi',
  active: true,
}
