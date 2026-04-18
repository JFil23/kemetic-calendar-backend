-- Seed canonical Kemetic nodes and doctrine links (condensed from mobile library)
-- Avoid duplicate inserts by using on conflict(slug).

insert into public.nodes (slug, title, glyph, body_text, aliases, node_type, sort_key)
values
('maat', 'Ma’at', '𓆄', 'Ma’at is the condition where all things function correctly and are held in right relation.', '["Maat"]'::jsonb, 'metaphysical', 1),
('isfet', 'Isfet', '𓊹', 'Isfet is breakdown and disorder when Ma’at is not maintained.', '["isfet"]'::jsonb, 'metaphysical', 2),
('ptah', 'Ptah', '𓊪𓏏𓎛', 'Ptah forms through heart and tongue—what is conceived and spoken takes effect.', '["Ptah"]'::jsonb, 'builder', 3),
('djehuty', 'Djehuty', '𓅝', 'Djehuty (Thoth) measures, records, and keeps what is correct.', '["Thoth","Djehuty"]'::jsonb, 'netjer', 4),
('ra', 'Ra', '𓇳', 'Ra is continuation through completed movement; his journey restores order each cycle.', '["Ra"]'::jsonb, 'cosmic', 5),
('ausar', 'Ausar', '𓁹', 'Ausar (Osiris) is restoration through gathering what was broken.', '["Osiris","Ausar","Asar"]'::jsonb, 'netjer', 6),
('aset', 'Aset', '𓊨', 'Aset (Isis) acts through strategy, timing, and speech that brings change.', '["Isis","Aset"]'::jsonb, 'netjer', 7),
('heru', 'Heru', '𓅃', 'Heru (Horus) is rightful position proven through contest and judgment.', '["Horus","Heru"]'::jsonb, 'netjer', 8),
('serpent', 'Serpent', '𓆑', 'Serpent power must be positioned—contained it protects, uncontrolled it opposes.', '["Apophis","Mehen"]'::jsonb, 'animal', 9),
('nile', 'Nile', '𓇋𓏏𓊖', 'The Nile’s inundation brings renewal; its cycle sustains life.', '["Hapy","Nile"]'::jsonb, 'earth', 10),
('sopdet', 'Sopdet', '𓇼', 'Sopdet (Sirius) heralds renewal and the new year; she signals timing.', '["Sothis","Sirius","Sopdet"]'::jsonb, 'cosmic', 11),
('ka', 'Ka', '𓂓', 'Ka is sustained presence that must be fed to endure.', '["Ka"]'::jsonb, 'metaphysical', 12),
('ba', 'Ba', '𓅽', 'Ba is movement and return between states; it departs and must come back.', '["Ba"]'::jsonb, 'metaphysical', 13),
('ib', 'Ib', '𓄣', 'Ib (heart) is the seat of discernment and measure.', '["Ib","Heart"]'::jsonb, 'metaphysical', 14),
('ren', 'Ren', '𓂋𓈖', 'Ren (name) is identity that endures when spoken and remembered.', '["Ren","Name"]'::jsonb, 'metaphysical', 15),
('sheut', 'Sheut', '𓈐', 'Sheut (shadow) is presence projected beyond form.', '["Sheut"]'::jsonb, 'metaphysical', 16),
('akh', 'Akh', '𓅜', 'Akh is effective spirit made luminous after proper rites.', '["Akh"]'::jsonb, 'metaphysical', 17),
('sah', 'Sah', '✷', 'Sah (Orion) is linked to Ausar and visibility of endurance across the sky.', '["Orion","Sah"]'::jsonb, 'cosmic', 18),
('renenutet', 'Renenutet', '𓆤', 'Renenutet guards nourishment and harvest balance.', '["Renenutet"]'::jsonb, 'netjer', 19),
('imhotep', 'Imhotep', '𓇋𓐍𓅓𓏏𓊪', 'Imhotep embodies applied wisdom through building and healing.', '["Imhotep"]'::jsonb, 'builder', 20)
on conflict (slug) do update set
  title = excluded.title,
  glyph = excluded.glyph,
  body_text = excluded.body_text,
  aliases = excluded.aliases,
  node_type = excluded.node_type,
  sort_key = excluded.sort_key,
  updated_at = now();

-- Doctrine links (lightweight seed)
insert into public.node_links (source_node_id, target_node_id, link_phrase, link_type, weight)
select s.id, t.id, p.phrase, p.link_type, p.weight
from (
  values
    ('maat','isfet','opposes','opposes',2.0),
    ('maat','ptah','supports','supports',1.5),
    ('maat','djehuty','measured by Djehuty','measures',1.2),
    ('ptah','maat','speech establishes Ma’at','supports',1.5),
    ('djehuty','maat','records Ma’at','supports',1.4),
    ('ra','serpent','Ra opposed by Apophis','opposes',2.0),
    ('ausar','aset','restored by','restores',1.5),
    ('aset','ausar','restores','restores',1.5),
    ('ra','maat','carries Ma’at','supports',1.2),
    ('sopdet','nile','signals flood','signals',1.1),
    ('ren','ka','ren sustains ka','supports',1.0),
    ('ka','ren','depends on name','supports',1.0),
    ('renenutet','ka','feeds','supports',1.0),
    ('sah','ausar','associated with Ausar','associated_with',1.0)
) as p(source_slug, target_slug, phrase, link_type, weight)
join public.nodes s on s.slug = p.source_slug
join public.nodes t on t.slug = p.target_slug
on conflict do nothing;
