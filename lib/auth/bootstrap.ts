// Local-mode bootstrap. Without a cloud database SIMBLIP still runs fully
// offline in this browser; the only seeded account is the platform operator,
// who provisions real institutions and people from the /dev console. There is
// no sample tenant — every institution on the platform is one you created.

import type { Institution, Profile } from './types'

export const PLATFORM_TENANT: Institution = {
  id: 'inst-platform',
  name: 'SIMBLIP Platform',
  slug: 'simblip-platform',
  accentColor: '#3b82f6',
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
