// Variety layout: farm map with soil numbers and cultivar names. Drag a cultivar name onto another field to swap
// the two cultivars, or drag a cultivar from the legend list onto a field to assign it. Changes are saved to the DB.
import React, { useEffect, useState } from 'react';
import { api, post, put } from '../api';
import FarmMap from '../components/FarmMap';
import { Loading, PageTitle, Panel, notify, notifyError } from '../components/ui';

export default function VarietyLayout() {
  const [fields, setFields] = useState(null);
  const [cultivars, setCultivars] = useState([]);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    api('/farm/fields').then(setFields).catch(notifyError);
    api('/farm/cultivars').then(setCultivars).catch(notifyError);
  }, []);
  if (!fields) return <Loading />;

  async function drop(target) {
    setHover(null);
    if (!drag) return;
    try {
      let r;
      if (drag.type === 'field') {
        if (drag.field.id === target.id) return;
        r = await post('/farm/layout/swap', { from_field: drag.field.id, to_field: target.id });
        notify(`Swapped cultivars of ${drag.field.soil_no} and ${target.soil_no}. Layout saved.`);
      } else {
        r = await put('/farm/fields/' + target.id + '/cultivar', { cultivar_id: drag.cultivar.id });
        notify(`${target.soil_no} is now planted with ${drag.cultivar.name}. Layout saved.`);
      }
      setFields(r.fields);
    } catch (e) { notifyError(e); } finally { setDrag(null); }
  }

  const areaBy = {};
  fields.forEach((f) => { areaBy[f.cultivar_id] = (areaBy[f.cultivar_id] || 0) + f.area_ha; });

  return (
    <div>
      <PageTitle>Variety layout plan</PageTitle>
      <div className="grid g-side-r">
        <Panel title="Farm map — drag a cultivar name onto another field">
          <FarmMap fields={fields} selectedId={hover}
            fillFor={(f) => f.cultivar_color}
            labelFor={() => []}
            onFieldDragOver={(f) => setHover(f.id)}
            onFieldDrop={drop}
            legend={cultivars.map((c) => ({ color: c.color, label: c.name.replace(/ \(.*\)/, '') }))}
            renderFieldExtra={(f) => (
              <>
                <text x={f.x + 6} y={f.y + 16} className="lbl">{f.soil_no}</text>
                <foreignObject x={f.x + 4} y={f.y + 24} width={f.w - 8} height={f.h - 28}>
                  <div draggable onDragStart={() => setDrag({ type: 'field', field: f })} onDragEnd={() => setHover(null)}
                    title="Drag to another field to swap"
                    style={{ cursor: 'grab', fontSize: 11, background: 'rgba(255,255,255,.85)', borderRadius: 4, padding: '2px 4px', lineHeight: 1.2 }}>
                    {f.cultivar_name}
                  </div>
                </foreignObject>
              </>
            )} />
        </Panel>
        <Panel title="Cultivars (drag onto a field)">
          {cultivars.map((c) => (
            <div key={c.id} draggable onDragStart={() => setDrag({ type: 'cultivar', cultivar: c })}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderBottom: '1px solid var(--line)', cursor: 'grab' }}>
              <span style={{ width: 16, height: 16, borderRadius: 3, background: c.color, display: 'inline-block' }} />
              <span style={{ flex: 1 }}>{c.name}<div className="small muted">{c.crop} · {c.maturity_days} days · {c.potential_yield} t/ha</div></span>
              <span className="small">{(areaBy[c.id] || 0).toFixed(1)} ha</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
