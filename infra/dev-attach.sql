-- Dev: anexo de exemplo no card #1 (valida kind='link' após 0005).
insert into attachment (organization_id, card_id, kind, url, label)
select organization_id, id, 'link', 'https://exemplo.com/emenda-1.pdf', '1ª Emenda'
from card order by number limit 1;
