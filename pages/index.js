import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import { parseRadius, buildSectionSTL, dlBlob, isValidConfig, getSag, getCurveRadius } from '../components/dishGeometry';

const FREE_USES = 3;

// ─── Preset printer beds ──────────────────────────────────────────────────────
const PRINTER_PRESETS = [
  { label: 'Ender 3 / small',   w: 220,  h: 220 },
  { label: 'Prusa MK4',         w: 250,  h: 210 },
  { label: 'Bambu P1/X1',       w: 256,  h: 256 },
  { label: 'Bambu X1 0.4mm',    w: 256,  h: 256 },
  { label: 'Voron 2.4 300',     w: 300,  h: 300 },
  { label: 'Custom 600×600',    w: 600,  h: 600 },
  { label: 'CNC bed 1200×600',  w: 1200, h: 600 },
];

const RADIUS_PRESETS = [
  { label: "14 ft — Guitar top",   raw: "14ft"  },
  { label: "25 ft — Guitar back",  raw: "25ft"  },
  { label: "15 ft — Mandolin top", raw: "15ft"  },
  { label: "28 ft — Violin plate", raw: "28ft"  },
  { label: "1000 mm",              raw: "1000mm" },
];

// ─── Canvas: cross-section ────────────────────────────────────────────────────
function ProfileCanvas({ R, dishW, dishH, rimWidth, thickness }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    if (!R || !dishW || !rimWidth || !thickness) return;

    const curveR = getCurveRadius(dishW, dishH, rimWidth);
    if (R <= curveR) return;
    const sag = R - Math.sqrt(R*R - curveR*curveR);
    const totalH = sag + thickness;
    const scale = Math.min((W*0.72)/dishW, (H*0.62)/totalH);
    const cx = W/2, rimY = H*0.26;
    const wx = x => cx + x*scale;
    const wz = z => rimY - z*scale;
    const BOT = -thickness;
    const Rpx = R*scale, CRpx = curveR*scale;
    const sphereCanvasY = wz(R - sag);
    const arcAngle = Math.asin(Math.min(1, CRpx/Rpx));

    ctx.beginPath();
    ctx.moveTo(wx(-dishW/2), wz(0));
    ctx.lineTo(wx(-curveR), wz(0));
    ctx.arc(cx, sphereCanvasY, Rpx, Math.PI+arcAngle, -arcAngle, false);
    ctx.lineTo(wx(dishW/2), wz(0));
    ctx.lineTo(wx(dishW/2), wz(BOT));
    ctx.lineTo(wx(-dishW/2), wz(BOT));
    ctx.closePath();

    const fill = ctx.createLinearGradient(cx,rimY,cx,wz(BOT));
    fill.addColorStop(0,'rgba(175,130,70,0.28)');
    fill.addColorStop(0.5,'rgba(145,100,45,0.42)');
    fill.addColorStop(1,'rgba(90,60,20,0.52)');
    ctx.fillStyle=fill; ctx.fill();
    ctx.strokeStyle='#c8904a'; ctx.lineWidth=2; ctx.stroke();

    const sheen = ctx.createLinearGradient(wx(-curveR),rimY,cx,wz(-sag));
    sheen.addColorStop(0,'rgba(255,215,130,0)');
    sheen.addColorStop(0.5,'rgba(255,215,130,0.15)');
    sheen.addColorStop(1,'rgba(255,215,130,0)');
    ctx.beginPath();
    ctx.arc(cx, sphereCanvasY, Rpx, Math.PI+arcAngle, -arcAngle, false);
    ctx.strokeStyle=sheen; ctx.lineWidth=7; ctx.stroke();

    ctx.setLineDash([3,3]); ctx.strokeStyle='rgba(200,150,55,0.3)'; ctx.lineWidth=1;
    const dimY=rimY-20, sagX=wx(dishW/2)+14, sagPx=sag*scale, thkX=wx(-dishW/2)-14;
    ctx.beginPath();
    ctx.moveTo(wx(-dishW/2),rimY); ctx.lineTo(wx(-dishW/2),dimY);
    ctx.moveTo(wx(dishW/2),rimY); ctx.lineTo(wx(dishW/2),dimY);
    ctx.moveTo(wx(-dishW/2),dimY); ctx.lineTo(wx(dishW/2),dimY);
    ctx.moveTo(sagX-4,rimY); ctx.lineTo(sagX+4,rimY);
    ctx.moveTo(sagX,rimY); ctx.lineTo(sagX,rimY+sagPx);
    ctx.moveTo(sagX-4,rimY+sagPx); ctx.lineTo(sagX+4,rimY+sagPx);
    ctx.moveTo(thkX,rimY); ctx.lineTo(thkX,wz(BOT));
    ctx.stroke(); ctx.setLineDash([]);

    ctx.font='bold 11px Georgia,serif'; ctx.fillStyle='#e8c87a'; ctx.textAlign='center';
    ctx.fillText(`⌀ ${dishW} mm`, cx, dimY-5);
    ctx.font='10px Georgia,serif'; ctx.fillStyle='#d4a850';
    ctx.textAlign='left'; ctx.fillText(`sag ${sag.toFixed(2)}mm`, sagX+7, rimY+sagPx/2+4);
    ctx.textAlign='right'; ctx.fillText(`${thickness}mm`, thkX-3, (rimY+wz(BOT))/2+4);
    ctx.fillStyle='rgba(200,150,50,0.5)'; ctx.textAlign='center';
    ctx.fillText(`${rimWidth}mm rim`, wx(dishW/2 - rimWidth/2), rimY-6);
  }, [R, dishW, dishH, rimWidth, thickness]);
  return <canvas ref={ref} width={480} height={220} style={{width:'100%',height:'auto',display:'block'}}/>;
}

// ─── Canvas: top-down section grid ───────────────────────────────────────────
function SectionDiagram({ dishW, dishH, sectionsX, sectionsY, rimWidth }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W=canvas.width, H=canvas.height;
    ctx.clearRect(0,0,W,H);
    const asp = dishW/dishH;
    const maxW = W*0.85, maxH = H*0.85;
    const sw = Math.min(maxW, maxH*asp);
    const sh = sw/asp;
    const ox=(W-sw)/2, oy=(H-sh)/2;
    const scX=sw/dishW, scY=sh/dishH;
    const curveR=getCurveRadius(dishW,dishH,rimWidth);

    const colors=['rgba(200,140,50,0.20)','rgba(180,115,40,0.26)'];
    for (let row=0; row<sectionsY; row++) {
      for (let col=0; col<sectionsX; col++) {
        const x=ox+col*(sw/sectionsX), y=oy+row*(sh/sectionsY);
        const w=sw/sectionsX, h=sh/sectionsY;
        ctx.fillStyle=colors[(col+row)%2];
        ctx.strokeStyle='#c8904a'; ctx.lineWidth=1.5;
        ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
        ctx.font='bold 10px Georgia,serif'; ctx.fillStyle='#e8c87a'; ctx.textAlign='center';
        ctx.fillText(`C${col+1}R${sectionsY-row}`, x+w/2, y+h/2-4);
        ctx.font='8px Georgia,serif'; ctx.fillStyle='rgba(220,170,75,0.5)';
        ctx.fillText(`${Math.round(dishW/sectionsX)}×${Math.round(dishH/sectionsY)}mm`, x+w/2, y+h/2+8);
      }
    }

    const cxC=ox+sw/2, cyC=oy+sh/2;
    const g=ctx.createRadialGradient(cxC,cyC,0,cxC,cyC,curveR*scX);
    g.addColorStop(0,'rgba(220,160,55,0.13)'); g.addColorStop(1,'rgba(220,160,55,0.02)');
    ctx.beginPath(); ctx.arc(cxC,cyC,curveR*scX,0,Math.PI*2);
    ctx.fillStyle=g; ctx.fill();
    ctx.strokeStyle='rgba(220,160,70,0.45)'; ctx.lineWidth=1.5;
    ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);

    ctx.font='9px Georgia,serif'; ctx.fillStyle='rgba(220,165,65,0.55)'; ctx.textAlign='center';
    ctx.fillText(`⌀${Math.round(curveR*2)}mm curved`, cxC, cyC+4);
    ctx.fillText(`${rimWidth}mm rim`, cxC, oy-6);
  }, [dishW, dishH, sectionsX, sectionsY, rimWidth]);
  return <canvas ref={ref} width={210} height={210} style={{width:'100%',height:'auto',display:'block'}}/>;
}

// ─── Paywall ──────────────────────────────────────────────────────────────────
function PaywallModal({ onClose, onSubscribe, loading }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:100,
      display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
      <div style={{background:'#1a1005',border:'1px solid rgba(200,150,55,0.4)',
        borderRadius:'12px',padding:'36px',maxWidth:'420px',width:'100%',
        textAlign:'center',fontFamily:'Georgia,serif',color:'#d4b87a'}}>
        <div style={{fontSize:'36px',marginBottom:'12px'}}>🎸</div>
        <h2 style={{margin:'0 0 10px',fontSize:'20px',letterSpacing:'0.1em',
          color:'#eac870',fontWeight:'normal'}}>FREE TRIAL COMPLETE</h2>
        <p style={{fontSize:'13px',lineHeight:'1.7',color:'rgba(200,150,55,0.7)',margin:'0 0 24px'}}>
          Subscribe to unlock unlimited radius dish generation for all your lutherie and CNC projects.
        </p>
        <div style={{background:'rgba(200,150,55,0.08)',border:'1px solid rgba(200,150,55,0.25)',
          borderRadius:'8px',padding:'20px',marginBottom:'24px'}}>
          <div style={{fontSize:'32px',fontWeight:'bold',color:'#eac870'}}>£9.99</div>
          <div style={{fontSize:'12px',color:'rgba(200,150,55,0.55)',marginTop:'4px'}}>per month · cancel anytime</div>
          <div style={{marginTop:'14px',fontSize:'12px',color:'rgba(200,150,55,0.6)',lineHeight:'1.8'}}>
            ✓ Unlimited custom radii<br/>
            ✓ Any dish size — 3D printer or CNC<br/>
            ✓ Any number of sections<br/>
            ✓ Imperial &amp; metric input<br/>
            ✓ All future updates included
          </div>
        </div>
        <button onClick={onSubscribe} disabled={loading}
          style={{width:'100%',background:'rgba(200,150,55,0.2)',border:'1px solid #c8904a',
            borderRadius:'7px',color:'#f0d070',cursor:'pointer',fontFamily:'Georgia,serif',
            fontSize:'14px',fontWeight:'bold',letterSpacing:'0.12em',padding:'13px',
            textTransform:'uppercase',marginBottom:'10px'}}>
          {loading ? 'Redirecting…' : 'Subscribe for £9.99/month'}
        </button>
        <button onClick={onClose}
          style={{background:'none',border:'none',color:'rgba(200,150,55,0.4)',
            cursor:'pointer',fontFamily:'Georgia,serif',fontSize:'11px',padding:'6px'}}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ─── Number input helper ──────────────────────────────────────────────────────
function NumInput({ label, value, onChange, min, max, step, unit, hint }) {
  const C = {
    row: {marginBottom:'12px'},
    lbl: {display:'flex',justifyContent:'space-between',fontSize:'11px',
      color:'rgba(200,150,55,0.6)',marginBottom:'5px',letterSpacing:'0.05em'},
    inp: {background:'rgba(28,18,5,0.9)',border:'1px solid rgba(200,150,55,0.3)',
      borderRadius:'5px',color:'#f2d478',fontFamily:'Georgia,serif',fontSize:'16px',
      padding:'7px 10px',width:'100%',boxSizing:'border-box',outline:'none'},
    hint: {fontSize:'10px',color:'rgba(200,150,55,0.35)',marginTop:'3px'},
  };
  return (
    <div style={C.row}>
      <div style={C.lbl}><span>{label}</span><span style={{color:'#eac870'}}>{value} {unit}</span></div>
      <input type="number" style={C.inp} value={raw} min={min} max={max} step={step}
       
        onFocus={e=>e.target.style.borderColor='#c8904a'}
        onBlur={e => {
      {hint && <div style={C.hint}>{hint}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [radiusInput, setRadiusInput] = useState('14ft');
  const [dishW,    setDishW]    = useState(600);
  const [dishH,    setDishH]    = useState(600);
  const [rimWidth, setRimWidth] = useState(50);
  const [thickness,setThickness]= useState(50);
  const [sectionsX,setSectionsX]= useState(2);
  const [sectionsY,setSectionsY]= useState(2);
  const [segments, setSegments] = useState(48);
  const [genItem,  setGenItem]  = useState(null);
  const [status,   setStatus]   = useState(null);
  const [showPaywall,setShowPaywall]=useState(false);
  const [subLoading, setSubLoading]=useState(false);
  const [usesLeft,   setUsesLeft]  =useState(FREE_USES);
  const [subscribed, setSubscribed]=useState(false);

  useEffect(() => {
    if (typeof window==='undefined') return;
    const uses=parseInt(localStorage.getItem('rda_uses')||'0');
    const sub=localStorage.getItem('rda_subscribed')==='true';
    setUsesLeft(Math.max(0,FREE_USES-uses));
    setSubscribed(sub);
  },[]);

  const R = parseRadius(radiusInput);
  const valid = R !== null && isValidConfig(dishW, dishH, rimWidth, thickness, R);
  const sag = valid ? getSag(R, dishW, dishH, rimWidth) : null;
  const curveR = valid ? getCurveRadius(dishW, dishH, rimWidth) : null;
  const totalSections = sectionsX * sectionsY;

  function recordUse() {
    if (subscribed) return true;
    const uses=parseInt(localStorage.getItem('rda_uses')||'0')+1;
    localStorage.setItem('rda_uses',uses);
    setUsesLeft(Math.max(0,FREE_USES-uses));
    if (uses>FREE_USES){setShowPaywall(true);return false;}
    return true;
  }

  async function handleSubscribe() {
    setSubLoading(true);
    try {
      const res=await fetch('/api/create-checkout',{method:'POST',headers:{'Content-Type':'application/json'}});
      const {url}=await res.json();
      window.location.href=url;
    } catch { setSubLoading(false); alert('Payment error — please try again'); }
  }

  async function dlSection(col, row) {
    if (!valid||!recordUse()) return;
    const key=`${col}-${row}`;
    setGenItem(key); setStatus(`Generating section C${col+1}R${row+1}…`);
    await new Promise(r=>setTimeout(r,20));
    dlBlob(buildSectionSTL({R_sphere:R,dishW,dishH,rimWidth,thickness,sectionsX,sectionsY,secCol:col,secRow:row,N:segments}),
      `radius_dish_${radiusInput.replace(/\s+/g,'_')}_C${col+1}R${row+1}.stl`);
    setGenItem(null); setStatus(`Section C${col+1}R${row+1} downloaded ✓`);
    setTimeout(()=>setStatus(null),3000);
  }

  async function dlAll() {
    if (!valid||!recordUse()) return;
    setStatus(`Generating all ${totalSections} sections…`);
    for (let row=0;row<sectionsY;row++) {
      for (let col=0;col<sectionsX;col++) {
        const key=`${col}-${row}`;
        setGenItem(key);
        await new Promise(r=>setTimeout(r,20));
        dlBlob(buildSectionSTL({R_sphere:R,dishW,dishH,rimWidth,thickness,sectionsX,sectionsY,secCol:col,secRow:row,N:segments}),
          `radius_dish_${radiusInput.replace(/\s+/g,'_')}_C${col+1}R${row+1}.stl`);
        await new Promise(r=>setTimeout(r,60));
      }
    }
    setGenItem(null); setStatus(`All ${totalSections} sections downloaded ✓`);
    setTimeout(()=>setStatus(null),4000);
  }

  const C={
    root:{minHeight:'100vh',background:'#0e0a06',
      backgroundImage:`radial-gradient(ellipse at 30% 15%,rgba(170,115,35,0.09) 0%,transparent 55%),
                       radial-gradient(ellipse at 72% 82%,rgba(130,75,18,0.07) 0%,transparent 50%)`,
      fontFamily:"Georgia,'Times New Roman',serif",color:'#d4b87a',margin:0,padding:0},
    header:{borderBottom:'1px solid rgba(200,150,55,0.2)',padding:'18px 28px 14px',
      background:'rgba(14,10,4,0.8)',display:'flex',alignItems:'center',
      justifyContent:'space-between',flexWrap:'wrap',gap:'10px'},
    h1:{margin:0,fontSize:'18px',fontWeight:'normal',letterSpacing:'0.28em',
      color:'#eac870',textTransform:'uppercase'},
    sub:{marginTop:'3px',fontSize:'11px',letterSpacing:'0.12em',color:'rgba(200,150,55,0.42)'},
    badge:{background:'rgba(200,150,55,0.12)',border:'1px solid rgba(200,150,55,0.3)',
      borderRadius:'20px',padding:'5px 14px',fontSize:'11px',color:'rgba(220,170,65,0.8)'},
    layout:{maxWidth:'960px',margin:'0 auto',padding:'20px',
      display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'},
    card:{background:'rgba(22,15,6,0.7)',border:'1px solid rgba(200,150,55,0.17)',
      borderRadius:'8px',padding:'18px'},
    ttl:{fontSize:'9px',letterSpacing:'0.24em',textTransform:'uppercase',
      color:'rgba(200,150,55,0.42)',marginBottom:'12px'},
    bigInput:{width:'100%',boxSizing:'border-box',background:'rgba(28,18,5,0.92)',
      border:'2px solid rgba(200,150,55,0.38)',borderRadius:'6px',
      color:'#f2d478',fontFamily:'Georgia,serif',fontSize:'28px',
      padding:'10px 14px',outline:'none',marginBottom:'6px'},
    hint:{fontSize:'11px',color:'rgba(200,150,55,0.35)',marginBottom:'14px'},
    presetRow:{display:'flex',flexWrap:'wrap',gap:'5px',marginBottom:'16px'},
    pBtn:{background:'rgba(200,150,55,0.08)',border:'1px solid rgba(200,150,55,0.2)',
      borderRadius:'4px',color:'rgba(210,160,65,0.75)',cursor:'pointer',
      fontFamily:'Georgia,serif',fontSize:'10px',padding:'4px 8px'},
    stats:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',
      background:'rgba(14,9,2,0.6)',border:'1px solid rgba(200,150,55,0.1)',
      borderRadius:'6px',padding:'12px',marginBottom:'16px'},
    statLbl:{fontSize:'10px',color:'rgba(200,150,55,0.45)'},
    statVal:{fontSize:'14px',color:'#eac870',fontWeight:'bold',marginTop:'1px'},
    statSub:{fontSize:'10px',color:'rgba(200,150,55,0.33)',marginTop:'1px'},
    divider:{borderTop:'1px solid rgba(200,150,55,0.12)',margin:'14px 0'},
    segRow:{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px',
      fontSize:'10px',color:'rgba(200,150,55,0.45)'},
    range:{flex:1,accentColor:'#c8904a'},
    sectionGrid:{display:'grid',gap:'5px',marginBottom:'8px'},
    secBtn:{background:'rgba(200,150,55,0.09)',border:'1px solid rgba(200,150,55,0.25)',
      borderRadius:'4px',color:'#e0c06a',cursor:'pointer',fontFamily:'Georgia,serif',
      fontSize:'10px',padding:'7px 5px',textAlign:'center'},
    secBtnActive:{background:'rgba(200,150,55,0.28)',border:'1px solid #c8904a'},
    allBtn:{background:'rgba(200,150,55,0.14)',border:'1px solid rgba(200,150,55,0.45)',
      borderRadius:'6px',color:'#f0d070',cursor:'pointer',fontFamily:'Georgia,serif',
      fontSize:'12px',fontWeight:'bold',letterSpacing:'0.1em',padding:'10px',
      textTransform:'uppercase',width:'100%'},
    statusBar:{background:'rgba(200,150,55,0.07)',border:'1px solid rgba(200,150,55,0.17)',
      borderRadius:'5px',color:'#e8c870',fontSize:'11px',marginTop:'8px',
      padding:'7px 12px',textAlign:'center'},
    warn:{background:'rgba(200,75,25,0.08)',border:'1px solid rgba(200,75,25,0.28)',
      borderRadius:'5px',color:'#e09060',fontSize:'11px',padding:'7px 10px',marginTop:'6px'},
    infoText:{fontSize:'10px',color:'rgba(200,150,55,0.33)',lineHeight:'1.75',marginTop:'8px'},
  };

  return (
    <>
      <Head>
        <title>Radius Dish Generator — Parametric 3D Print &amp; CNC Tool</title>
        <meta name="description" content="Generate parametric radius dishes for any printer or CNC. Any radius, any size, any number of sections." />
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
      </Head>

      {showPaywall && <PaywallModal onClose={()=>setShowPaywall(false)} onSubscribe={handleSubscribe} loading={subLoading}/>}

      <div style={C.root}>
        <header style={C.header}>
          <div>
            <h1 style={C.h1}>Radius Dish Generator</h1>
            <div style={C.sub}>Parametric · any printer · any CNC · any radius</div>
          </div>
          {!subscribed
            ? <div style={C.badge}>{usesLeft>0?`${usesLeft} free download${usesLeft===1?'':'s'} remaining`:'🔒 Subscribe to continue'}</div>
            : <div style={{...C.badge,background:'rgba(80,200,100,0.1)',borderColor:'rgba(80,200,100,0.3)',color:'rgba(120,220,120,0.8)'}}>✓ Subscribed</div>
          }
        </header>

        <div style={C.layout}>

          {/* ── Col 1: Radius + Dish Size ── */}
          <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
            <div style={C.card}>
              <div style={C.ttl}>Sphere Radius</div>
              <input style={C.bigInput} value={radiusInput}
                onChange={e=>setRadiusInput(e.target.value)} placeholder="e.g. 14ft"
                spellCheck={false}
                onFocus={e=>e.target.style.borderColor='#c8904a'}
                onBlur={e=>e.target.style.borderColor='rgba(200,150,55,0.38)'}/>
              <div style={C.hint}>14ft · 14' · 4267mm · 4.267m · 168in</div>
              <div style={C.presetRow}>
                {RADIUS_PRESETS.map(p=>(
                  <button key={p.label} style={C.pBtn}
                    onClick={()=>setRadiusInput(p.raw)}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(200,150,55,0.2)'}
                    onMouseLeave={e=>e.currentTarget.style.background='rgba(200,150,55,0.08)'}
                  >{p.label}</button>
                ))}
              </div>

              {valid ? (
                <div style={C.stats}>
                  <div><div style={C.statLbl}>Sphere radius</div>
                    <div style={C.statVal}>{R.toFixed(1)} mm</div>
                    <div style={C.statSub}>{(R/304.8).toFixed(3)} ft</div></div>
                  <div><div style={C.statLbl}>Sag depth</div>
                    <div style={C.statVal}>{sag.toFixed(3)} mm</div></div>
                  <div><div style={C.statLbl}>Total height</div>
                    <div style={C.statVal}>{(sag+thickness).toFixed(2)} mm</div></div>
                  <div><div style={C.statLbl}>Curved area</div>
                    <div style={C.statVal}>⌀{Math.round(curveR*2)} mm</div></div>
                </div>
              ) : radiusInput.length>0 ? (
                <div style={C.warn}>
                  {R===null?'Can\'t parse — try e.g. 14ft or 4267mm'
                    :R<=getCurveRadius(dishW,dishH,rimWidth)?`Radius must be larger than ${getCurveRadius(dishW,dishH,rimWidth).toFixed(0)}mm for this dish size`
                    :'Invalid value'}
                </div>
              ) : null}
            </div>

            <div style={C.card}>
              <div style={C.ttl}>Dish Dimensions</div>

              <div style={{...C.ttl,marginBottom:'8px',marginTop:'0'}}>Printer / Bed Presets</div>
              <div style={C.presetRow}>
                {PRINTER_PRESETS.map(p=>(
                  <button key={p.label} style={C.pBtn}
                    onClick={()=>{setDishW(p.w);setDishH(p.h);}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(200,150,55,0.2)'}
                    onMouseLeave={e=>e.currentTarget.style.background='rgba(200,150,55,0.08)'}
                  >{p.label}</button>
                ))}
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
                <NumInput label="Dish Width" value={dishW} onChange={setDishW} min={50} max={3000} step={10} unit="mm"/>
                <NumInput label="Dish Height" value={dishH} onChange={setDishH} min={50} max={3000} step={10} unit="mm"/>
                <NumInput label="Rim Width" value={rimWidth} onChange={setRimWidth} min={5} max={200} step={5} unit="mm" hint="Flat border around curved area"/>
                <NumInput label="Thickness" value={thickness} onChange={setThickness} min={5} max={200} step={5} unit="mm" hint="Total dish height"/>
              </div>
            </div>
          </div>

          {/* ── Col 2: Sections + Download ── */}
          <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
            <div style={C.card}>
              <div style={C.ttl}>Print Sections</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'14px'}}>
                <NumInput label="Columns (X)" value={sectionsX} onChange={v=>setSectionsX(Math.max(1,Math.min(10,v)))} min={1} max={10} step={1} unit="" hint="Left-right splits"/>
                <NumInput label="Rows (Y)" value={sectionsY} onChange={v=>setSectionsY(Math.max(1,Math.min(10,v)))} min={1} max={10} step={1} unit="" hint="Front-back splits"/>
              </div>
              <div style={{...C.statLbl,marginBottom:'8px'}}>
                Section size: <span style={{color:'#eac870',fontWeight:'bold'}}>{Math.round(dishW/sectionsX)} × {Math.round(dishH/sectionsY)} mm</span>
                {' · '}{totalSections} piece{totalSections!==1?'s':''}
              </div>

              <div style={C.divider}/>
              <div style={C.ttl}>Mesh Quality</div>
              <div style={C.segRow}>
                <span>Draft</span>
                <input type="range" style={C.range} min="24" max="96" step="8"
                  value={segments} onChange={e=>setSegments(Number(e.target.value))}/>
                <span>Ultra</span>
                <span style={{color:'#eac870',minWidth:'80px',fontSize:'10px'}}>
                  {segments<40?'Draft':segments<64?'Standard':segments<80?'Fine':'Ultra'} ({segments})
                </span>
              </div>

              <div style={C.divider}/>
              <div style={C.ttl}>Download Sections</div>

              {/* Section grid buttons */}
              <div style={{...C.sectionGrid, gridTemplateColumns:`repeat(${sectionsX}, 1fr)`}}>
                {Array.from({length:sectionsY}).map((_,row)=>
                  Array.from({length:sectionsX}).map((_,col)=>{
                    const key=`${col}-${row}`;
                    return (
                      <button key={key}
                        style={{...C.secBtn,...(genItem===key?C.secBtnActive:{})}}
                        disabled={!valid||genItem!==null}
                        onClick={()=>dlSection(col,sectionsY-1-row)}
                        onMouseEnter={e=>valid&&(e.currentTarget.style.background='rgba(200,150,55,0.22)')}
                        onMouseLeave={e=>(e.currentTarget.style.background=genItem===key?'rgba(200,150,55,0.28)':'rgba(200,150,55,0.09)')}
                      >
                        {genItem===key?'⏳':''} C{col+1}R{sectionsY-row}
                      </button>
                    );
                  })
                )}
              </div>

              <button style={{...C.allBtn,marginTop:'8px'}}
                disabled={!valid||genItem!==null}
                onClick={dlAll}
                onMouseEnter={e=>valid&&(e.currentTarget.style.background='rgba(200,150,55,0.26)')}
                onMouseLeave={e=>(e.currentTarget.style.background='rgba(200,150,55,0.14)')}
              >
                ⬇ Download All {totalSections} Sections
              </button>
              {status && <div style={C.statusBar}>{status}</div>}
            </div>

            <div style={C.card}>
              <div style={C.ttl}>Cross-Section Profile</div>
              <ProfileCanvas R={valid?R:null} dishW={dishW} dishH={dishH} rimWidth={rimWidth} thickness={thickness}/>
            </div>

            <div style={C.card}>
              <div style={C.ttl}>Top View — Print Sections</div>
              <SectionDiagram dishW={dishW} dishH={dishH} sectionsX={sectionsX} sectionsY={sectionsY} rimWidth={rimWidth}/>
              <p style={C.infoText}>
                Print each section flat-side down, no supports needed.
                Assemble using the flat rim as reference edge.
                Each section: {Math.round(dishW/sectionsX)} × {Math.round(dishH/sectionsY)} mm.
              </p>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
