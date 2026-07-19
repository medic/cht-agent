/**
 * Repo-relative path resolution for the two XLSForm artifacts the deterministic
 * orchestrator handles: app forms (`configArtifact: form`) live under
 * `forms/app/`, contact forms (`configArtifact: contact-form`) under
 * `forms/contact/`. Every place that used to hardcode `forms/app/<form>.*` (the
 * applier, the code-gen brief, and — transitively via the apply result — the
 * post-approval copy of the corrected files into the mount) routes through here
 * so the two layouts stay in one place.
 *
 * Deliberately dependency-free (no cht-conf, no fs): a pure string mapping so it
 * can be imported anywhere without pulling the runner in.
 */

/** The two configArtifacts the XLSForm orchestrator resolves paths for. */
export type FormConfigArtifact = 'form' | 'contact-form';

/** The resolved repo-relative form locations for one artifact + form. */
export interface FormRelPaths {
  /** The forms directory for this artifact, repo-relative (e.g. `forms/app`). */
  formsDir: string;
  /** The binary workbook, repo-relative (e.g. `forms/app/<form>.xlsx`). */
  xlsxRelPath: string;
  /** The generated XForm, repo-relative (e.g. `forms/app/<form>.xml`). */
  xmlRelPath: string;
}

/** Which forms directory each supported artifact maps to. */
const FORMS_DIR_BY_ARTIFACT: Record<FormConfigArtifact, string> = {
  form: 'forms/app',
  'contact-form': 'forms/contact',
};

/**
 * Resolve the repo-relative `.xlsx`/`.xml` paths for a form. `form` maps to
 * `forms/app/`, `contact-form` to `forms/contact/`. Throws a clear error for any
 * other artifact — the XLSForm apply path only handles these two.
 */
export const resolveFormRelPaths = (
  configArtifact: string,
  form: string
): FormRelPaths => {
  const formsDir = FORMS_DIR_BY_ARTIFACT[configArtifact as FormConfigArtifact];
  if (formsDir === undefined) {
    throw new Error(
      `resolveFormRelPaths: unsupported configArtifact "${configArtifact}" ` +
        `(the XLSForm apply path handles only ${Object.keys(FORMS_DIR_BY_ARTIFACT)
          .map((a) => `"${a}"`)
          .join(' and ')})`
    );
  }
  return {
    formsDir,
    xlsxRelPath: `${formsDir}/${form}.xlsx`,
    xmlRelPath: `${formsDir}/${form}.xml`,
  };
};

/**
 * The deployed form id cht-conf uploads a form under — the id the
 * `/api/v1/forms/<id>.xml` endpoint serves it from AND (prefixed with `form:`)
 * the `form:<id>` CouchDB doc id that `fetchFormRevs` keys the rev by.
 *
 * - `form` → the base name verbatim (`pregnancy_home_visit` →
 *   `pregnancy_home_visit`).
 * - `contact-form` → `contact:` + the base name with EVERY dash turned into a
 *   colon and underscores preserved, mirroring cht-conf `upload-forms.js`
 *   (`e_household-create.xlsx` → doc `_id = form:contact:e_household:create`).
 *
 * Deliberately distinct from the on-disk base name (`resolveFormRelPaths` keeps
 * the dashed file name): the apply's per-form `-- <form>` filter matches the
 * xlsx BASENAME, while the deployed-fetch and the rev lookup match this id.
 * Throws for any other artifact — the same two-artifact boundary as the resolver.
 */
export const deployedFormId = (
  configArtifact: string,
  form: string
): string => {
  if (configArtifact === 'form') {
    return form;
  }
  if (configArtifact === 'contact-form') {
    return `contact:${form.replace(/-/g, ':')}`;
  }
  throw new Error(
    `deployedFormId: unsupported configArtifact "${configArtifact}" ` +
      `(the XLSForm apply path handles only ${Object.keys(FORMS_DIR_BY_ARTIFACT)
        .map((a) => `"${a}"`)
        .join(' and ')})`
  );
};
