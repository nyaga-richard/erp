BEGIN;
-- 010 added allocation metadata to legacy counters. Its migration sentinel must
-- not masquerade as the human who historically allocated a document number.
-- Original source/journal actors are untouched. Runtime guards always stamp
-- real context on a NEW allocation; only unknown historical metadata is nullable.
ALTER TABLE document_sequences ALTER allocated_by DROP NOT NULL, ALTER allocated_at DROP NOT NULL;
UPDATE document_sequences SET allocated_by=NULL,allocated_at=NULL WHERE allocated_by='00000000-0000-4000-8000-000000000001';
COMMIT;
