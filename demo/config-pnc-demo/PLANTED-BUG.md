# PLANTED BUG — Pregnancy home visit danger-sign `relevant`

This config is a demo fixture for the cht-agent integration branch (mission 03, S9).
It is a pruned copy of cht-core's `config/default` with **one** deliberately broken
`relevant` expression planted in the Pregnancy home visit form. It pairs with the
ticket `tickets/demo-pnc-relevant.md`.

## Provenance

| | |
|---|---|
| Source repo | `medic/cht-core` (`config/default`) |
| Cloned commit | `57ea9228b1622ea2f6fde6d14afbc371a37d0d52` |
| cht-core version | `5.2.0` (from the cloned `package.json`) |
| Conversion tooling | `cht-conf` (`cht`) `6.5.0`, using bundled `xls2xform-medic` (pyxform fork) |

## The bug

**Form:** `pregnancy_home_visit` (title: "Pregnancy home visit")
**Question group:** `danger_signs` (the ongoing-pregnancy Danger Signs group)
**Config mechanism:** `relevant`

`cht convert-app-forms` regenerates the XML from the `.xlsx` via `xls2xform-medic`, so
the **xlsx is the source of truth** and carries the bug. The shipped `.xml` was then
regenerated from the edited xlsx by the real pipeline so the two stay consistent.

### Source of truth — xlsx

| | |
|---|---|
| File | `forms/app/pregnancy_home_visit.xlsx` |
| Sheet | `survey` (`xl/worksheets/sheet1.xml`) |
| Row | `153` — `begin group` / `name = danger_signs` |
| Column | `K` — the `relevant` column (header row 1) |
| Cell | `survey!K153` |

**Shared-string mechanics (why the edit is surgical):** the original `relevant`
string was shared-string index **360**, which three group cells reference —
`K153` (`danger_signs`), `K173` (`safe_pregnancy_practices`), `K205` (`summary`).
Editing index 360 in place would have broken all three. Instead a **new** shared
string was appended at index **860** (bumping `uniqueCount` 860 → 861) and **only**
`K153` was repointed `360 → 860`. `K173`/`K205` still point at 360 and are untouched.

### Shipped artifact — xml

| | |
|---|---|
| File | `forms/app/pregnancy_home_visit.xml` |
| Line | `1167` |
| XPath | `/h:html/h:head/model/bind[@nodeset="/data/danger_signs"]/@relevant` (default ns = `http://www.w3.org/2002/xforms`) |

### Original vs planted expression

```
ORIGINAL (correct):
  selected(../pregnancy_summary/visit_option, 'yes')

PLANTED (broken):
  selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')
```

`visit_option` is a `select_one visit_options`; its choices are
`yes | miscarriage | abortion | refused | migrated`. The original gate shows the
Danger Signs group only while the pregnancy is continuing (`yes`). The planted
clause `or selected(..., 'miscarriage')` makes the group **also** show for the
miscarriage outcome — it "no longer excludes the miscarriage outcome."

## Expected wrong behavior

When a CHW records the Pregnancy home visit outcome as **"No, Miscarriage"**
(`visit_option = 'miscarriage'`), the **Danger Signs** group still evaluates
`relevant = true` and is displayed, prompting for vaginal bleeding / fever / etc.
that are irrelevant once the pregnancy has ended. The form "keeps prompting after a
miscarriage is recorded." Notably it does **not** misfire for the `abortion` /
`refused` / `migrated` outcomes — only `miscarriage` — which is a useful diagnostic
tell that points straight at this clause. The sibling `safe_pregnancy_practices` and
`summary` groups correctly stay hidden for the miscarriage outcome.

## How the demo ticket describes the symptom

`tickets/demo-pnc-relevant.md` (frontmatter: `layer: cht-conf`,
`domain: forms-and-reports`, `configArtifact: form`, `artifactName: pregnancy_home_visit`,
`type: bug`) reports it from the CHW's point of view: *"Pregnancy home visit keeps
prompting danger-sign questions after a miscarriage is recorded."* It does not name the
cell or the fix — the fixer is expected to locate the `danger_signs` `relevant` and
restore the `yes`-only gate.

## Evidence (reproducible offline)

Baseline fidelity — reconverting the **unedited** xlsx with the installed cht-conf
reproduces cht-core's committed XML byte-for-byte (`diff` = 0 lines), so any diff below
is solely the planted change:

```
$ cht --source=<demo> --skip-dependency-check --skip-validate --skip-version-check \
      --skip-git-check --skip-translation-check convert-app-forms -- pregnancy_home_visit
$ diff -u <cht-core committed pregnancy_home_visit.xml> <regenerated pregnancy_home_visit.xml>
@@ -1164,7 +1164,7 @@
-      <bind nodeset="/data/danger_signs" relevant="selected(../pregnancy_summary/visit_option, 'yes')"/>
+      <bind nodeset="/data/danger_signs" relevant="selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')"/>
```

Sibling groups after regeneration (unchanged):

```
1185:  <bind nodeset="/data/safe_pregnancy_practices" relevant="selected(../pregnancy_summary/visit_option, 'yes')"/>
1207:  <bind nodeset="/data/summary"                  relevant="selected(../pregnancy_summary/visit_option, 'yes')"/>
```

## How to fix (for the demo resolution)

1. In `forms/app/pregnancy_home_visit.xlsx`, `survey!K153`, restore the `relevant` to
   `selected(../pregnancy_summary/visit_option, 'yes')`.
2. Regenerate the XML: `cht ... convert-app-forms -- pregnancy_home_visit`.
3. Confirm line 1167 reads the `yes`-only gate again and the diff vs upstream is empty.
