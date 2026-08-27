/**
 * test-data-generator design for the config-echis hierarchy (demo).
 *
 * Hierarchy (from app_settings contact_types):
 *   a_county → b_sub_county → c_community_health_unit →
 *   d_community_health_volunteer_area → e_household → f_client (patient)
 *   plus `person` = staff (the CHV) parented anywhere in the place tree.
 *
 * Generates one full branch + a CHV + households of client patients, then
 * test-data-generator pushes the docs DIRECTLY to CouchDB (no CSV, no cht-conf).
 *
 * RUN — copy this file INTO a cloned medic/test-data-generator checkout first:
 * the repo is "type": "module" (hence the ESM syntax below) and provides
 * @faker-js/faker, which only resolves from inside its tree:
 *   cp demo-seed-design.js <tdg-checkout>/ && cd <tdg-checkout>   # after npm ci
 *   export COUCH_URL='https://medic:password@localhost:10443/medic'  # host-side URL
 *   export NODE_TLS_REJECT_UNAUTHORIZED=0                            # self-signed
 *   npm run generate ./demo-seed-design.js
 *
 * NOTES
 *  - Verify the DesignSpec shape (getDoc signature, how `children` link the
 *    parent lineage) against the repo's sample-designs/ and adapt field names to
 *    what your PNC/registration forms actually read.
 *  - The agent's tier-1 QA proof needs NO seeded data (it fetches + asserts the
 *    deployed XForm). This data is for the LIVE/manual reproduction + demo realism.
 *  - For the PNC form to be launchable for an f_client, the client may need a
 *    prior pregnancy/delivery (config-gated) — register it in-app as the CHV, or
 *    add a `data_record` report doc to a client's children here once you confirm
 *    the pregnancy form's fields.
 */
import { faker } from '@faker-js/faker';

const placeDoc = (contact_type, name) => ({ type: 'contact', contact_type, name });
const personDoc = (contact_type, name, extra = {}) => ({
  type: 'contact', contact_type, name, sex: 'female', ...extra,
});

export default () => [
  {
    amount: 1,
    getDoc: () => placeDoc('a_county', 'Demo County'),
    children: [{
      amount: 1,
      getDoc: () => placeDoc('b_sub_county', 'Demo Sub-County'),
      children: [{
        amount: 1,
        getDoc: () => placeDoc('c_community_health_unit', 'Demo CHU'),
        children: [{
          amount: 1,
          getDoc: () => placeDoc('d_community_health_volunteer_area', 'Demo CHV Area'),
          children: [
            // the CHV staff person — becomes the login user's contact (create-users separately)
            {
              amount: 1,
              getDoc: () => personDoc('person', 'Demo CHV', {
                role: 'community_health_volunteer',
                phone: '+254700000000',
              }),
            },
            // households, each with client patients (f_client)
            {
              amount: 3,
              getDoc: () => placeDoc('e_household', `${faker.person.lastName()} Household`),
              children: [{
                amount: 2,
                getDoc: () => personDoc('f_client', `${faker.person.firstName('female')} ${faker.person.lastName()}`, {
                  date_of_birth: '1996-05-20',
                }),
              }],
            },
          ],
        }],
      }],
    }],
  },
];
