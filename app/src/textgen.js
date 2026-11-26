/* ================= TEXTE AUS GEPRÜFTEN ANGABEN ERZEUGEN (regelbasiert, ohne KI, ohne Kosten) =================
   Verwendet ausschließlich Felder, die ausgefüllt sind. Unbekanntes wird nie ergänzt oder geraten. */
const TextGen = (function(){
  const COLOR = { rot: 'Rotwein', weiss: 'Weißwein', rose: 'Roséwein', schaum: 'Schaumwein', orange: 'Orangewein', suess: 'Süßwein' };
  const LV = {   // Wortlaut je Skala: [niedrig, mittel, hoch]
    body:     ['leicht', 'mittelkräftig', 'kraftvoll'],
    acidity:  ['mild', 'ausgewogen', 'frisch'],
    tannin:   ['weich', 'moderat', 'kräftig strukturiert'],
    sweet:    ['trocken', 'halbtrocken', 'deutlich süß'],
    fruit:    ['zurückhaltend fruchtig', 'fruchtig', 'sehr fruchtbetont'],
    mineral:  ['wenig mineralisch', 'leicht mineralisch', 'ausgeprägt mineralisch'],
    oak:      ['ohne spürbares Holz', 'mit leichtem Holzeinsatz', 'mit deutlichem Holzeinfluss']
  };
  const LABEL = { body: 'Körper', acidity: 'Säure', tannin: 'Tannin', sweet: 'Süße', fruit: 'Frucht', mineral: 'Mineralik', oak: 'Holz' };
  const lvl = v=> { v = Number(v); return v <= 2 ? 0 : v === 3 ? 1 : 2; };
  const known = (p, k)=> p[k] != null && p[k] !== '' && Number(p[k]) >= 1 && Number(p[k]) <= 5;
  const list = a=> a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1];
  const cap = s=> s.charAt(0).toUpperCase() + s.slice(1);

  /* p = Profil (color, grapes[], abv, Skalen, aromas[], finish, serving_temp, aging, pairing_dishes[]), w = Wein (producer, origin) */
  function compose(p, w){
    const grapes = (p.grapes || []).filter(Boolean), aromas = (p.aromas || []).filter(Boolean), dishes = (p.pairing_dishes || []).filter(Boolean);
    const origin = (w && w.origin) || '';
    const color = COLOR[p.color] || '';
    const scales = Object.keys(LV).filter(k=> known(p, k));

    const tech = [];
    const head = [color || 'Wein', grapes.length ? 'aus ' + list(grapes) : '', origin ? 'von ' + (w.producer && w.producer !== '–' ? w.producer + ', ' : '') + origin : (w && w.producer && w.producer !== '–' ? 'von ' + w.producer : '')].filter(Boolean).join(' ');
    tech.push(head + '.');
    if(scales.length) tech.push(scales.map(k=> LABEL[k] + ' ' + LV[k][lvl(p[k])]).join(', ') + '.');
    if(aromas.length) tech.push('Aromen: ' + list(aromas) + '.');
    if(p.finish) tech.push('Abgang: ' + String(p.finish).trim().replace(/[.!]+$/, '') + '.');
    if(p.aging) tech.push('Ausbau: ' + String(p.aging).trim().replace(/[.!]+$/, '') + '.');
    if(p.abv !== '' && p.abv != null && isFinite(Number(p.abv))) tech.push('Alkohol: ' + String(p.abv).replace('.', ',') + ' % vol.');
    if(p.serving_temp) tech.push('Trinktemperatur: ' + String(p.serving_temp).trim() + '.');

    const serv = [];
    const feel = [];
    if(known(p, 'body')) feel.push(LV.body[lvl(p.body)]);
    if(known(p, 'acidity') && lvl(p.acidity) !== 1) feel.push(LV.acidity[lvl(p.acidity)]);
    if(known(p, 'tannin') && lvl(p.tannin) !== 1) feel.push(LV.tannin[lvl(p.tannin)]);
    if(known(p, 'sweet') && lvl(p.sweet) !== 1) feel.push(LV.sweet[lvl(p.sweet)]);
    if(color || origin || grapes.length) serv.push('Ein ' + (color || 'Wein') + (grapes.length ? ' aus ' + list(grapes) : '') + (origin ? ' aus ' + origin : '') + (feel.length ? ' – ' + list(feel) : '') + '.');
    if(aromas.length) serv.push('Im Glas ' + list(aromas.slice(0, 4)) + '.');
    if(dishes.length) serv.push('Passt sehr gut zu ' + list(dishes.slice(0, 3)) + '.');

    const sell = [];
    if(known(p, 'acidity') && lvl(p.acidity) === 2) sell.push('Frisch und lebendig durch die deutliche Säure');
    if(known(p, 'tannin') && lvl(p.tannin) === 0) sell.push('Weich im Mund, sehr zugänglich');
    if(known(p, 'tannin') && lvl(p.tannin) === 2) sell.push('Kräftige Struktur, ideal zu gehaltvollen Speisen');
    if(known(p, 'body') && lvl(p.body) === 0) sell.push('Leicht und unkompliziert zu trinken');
    if(known(p, 'body') && lvl(p.body) === 2) sell.push('Kraftvoller, vollmundiger Charakter');
    if(known(p, 'mineral') && lvl(p.mineral) === 2) sell.push('Ausgeprägte Mineralik');
    if(aromas.length >= 2) sell.push('Aromen von ' + list(aromas.slice(0, 3)));
    if(dishes.length) sell.push('Passt zu ' + list(dishes.slice(0, 2)));
    if(p.aging) sell.push('Ausbau: ' + String(p.aging).trim().replace(/[.!]+$/, ''));

    let hint = '';
    if(color && (feel.length || aromas.length)) hint = 'Für Gäste, die ' + color + ' mögen' + (feel.length ? ' (' + list(feel.slice(0, 2)) + ')' : '') + (aromas.length ? ' – mit Noten von ' + list(aromas.slice(0, 2)) : '') + '.';
    return {
      description_tech: tech.length > 1 ? tech.join(' ') : '',
      description_service: serv.join(' '),
      selling_points: sell.slice(0, 3),
      guest_hint: hint.length <= 300 ? hint : ''
    };
  }
  return { compose };
})();
