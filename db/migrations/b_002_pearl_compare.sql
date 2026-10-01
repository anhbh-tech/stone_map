-- Crew B v2: kết quả pearl_compare của design + progress thật của job.
-- designs.pc: JSON PcMeta (src/lib/personalize/engine.ts): theme, template, cutout, rev, job pearl_compare, pass/why.
-- designs.cutout_path: PNG pet pearl đã tách nền (storage/cutouts/…), để mở lại editor không cần pearl_compare.
ALTER TABLE designs ADD COLUMN pc TEXT;
ALTER TABLE designs ADD COLUMN cutout_path TEXT;
-- jobs.ext_id: id job ở pearl_compare; jobs.progress: progress 0–1 pearl_compare báo; jobs.steps: JSON JobStepView[].
ALTER TABLE jobs ADD COLUMN ext_id TEXT;
ALTER TABLE jobs ADD COLUMN progress REAL;
ALTER TABLE jobs ADD COLUMN steps TEXT;
