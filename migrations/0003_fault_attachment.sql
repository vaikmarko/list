-- Migration 0003: lisa fault_reports.attachment_count (mitu pilti/faili ticketiga seoti).
-- Created: 2026-06-16
--
-- SQLite ei toeta ALTER TABLE ADD COLUMN IF NOT EXISTS - migration jookseb iga
-- faili kohta tapselt korra (d1_migrations tabel), seega see on ohutu.
-- Kui veerg on juba olemas (manuaalne lisamine), annab teine jooks vea, mis on OK,
-- kuna migration ei kaivitu uuesti.

ALTER TABLE fault_reports ADD COLUMN attachment_count INTEGER;
