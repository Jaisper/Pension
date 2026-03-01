import { useState, useCallback, useRef } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, ReferenceLine, PieChart, Pie, Cell } from "recharts";

const TAX = {
  PAL_RATE: 0.153, TOPSKAT_THRESHOLD: 588900, TOPSKAT_RATE: 0.15,
  KOMMUNE_SKAT_AVG: 0.2514, BUNDSKAT: 0.1208, PERSONFRADRAG: 49700,
  FOLKEPENSION_BASIC: 82344, FOLKEPENSION_SUPPLEMENT: 91728,
  FOLKEPENSION_SUPPLEMENT_COUPLE: 46272, ATP_YEARLY: 3600,
  BOAFGIFT_RATE: 0.15, BOAFGIFT_BUNDFRADRAG: 333100,
};

const fmt = (n) => new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(n);
const fmtShort = (n) => { if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1)+" mio"; if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0)+"t"; return n.toFixed(0); };
const pct = (n) => (n * 100).toFixed(1) + "%";

function extractPensionData(text) {
  const data = { totalSavings:0, annualContribution:0, ratepension:0, livsvarig:0, aldersopsparing:0, kapitalpension:0, provider:"" };
  // Normalize: collapse whitespace, fix common OCR issues
  const t = text.replace(/\s+/g, ' ');
  
  // Provider detection
  ["PFA","Danica","Velliv","AP Pension","Nordea Liv","Topdanmark","SEB Pension","Sampension","PensionDanmark","Industriens Pension","PKA","Lærernes Pension","ATP","Skandia","Alm. Brand"].forEach(p => { 
    if (t.toLowerCase().includes(p.toLowerCase())) data.provider = data.provider || p; 
  });

  // Helper to parse Danish number formats: "1.234.567,89" or "1234567" or "1.234.567"
  const parseNum = (s) => {
    if (!s) return 0;
    // Remove spaces and dots used as thousand separators, handle comma as decimal
    let clean = s.replace(/\s/g, '');
    if (clean.includes(',')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else if ((clean.match(/\./g) || []).length > 1) {
      clean = clean.replace(/\./g, '');
    }
    return parseFloat(clean) || 0;
  };

  // Generic amount finder - finds all monetary amounts in text
  const amountRx = /(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)\s*(?:kr\.?|DKK)/gi;
  const amounts = [];
  let mx;
  while ((mx = amountRx.exec(t)) !== null) {
    const v = parseNum(mx[1]);
    if (v > 0) amounts.push(v);
  }

  // Also match plain numbers near pension keywords (PensionInfo often omits "kr")
  const plainNumRx = /(\d{1,3}(?:\.\d{3})+(?:,\d{2})?)/g;
  
  // Pension type patterns - broader matching for PensionInfo format
  const typePatterns = [
    { key: "ratepension", rxs: [/rate(?:pension|opsparing)[^0-9]{0,40}?(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)/gi, /(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)[^0-9]{0,20}?rate(?:pension|opsparing)/gi] },
    { key: "livsvarig", rxs: [/livsvarig[^0-9]{0,40}?(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)/gi, /livrente[^0-9]{0,40}?(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)/gi, /(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)[^0-9]{0,20}?livs(?:varig|rente)/gi] },
    { key: "aldersopsparing", rxs: [/alders(?:opsparing|pension)[^0-9]{0,40}?(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)/gi, /(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)[^0-9]{0,20}?alders(?:opsparing|pension)/gi] },
    { key: "kapitalpension", rxs: [/kapital(?:pension|opsparing)[^0-9]{0,40}?(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)/gi, /(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)[^0-9]{0,20}?kapital(?:pension|opsparing)/gi] },
  ];
  
  for (const tp of typePatterns) {
    for (const rx of tp.rxs) {
      let m;
      while ((m = rx.exec(t)) !== null) {
        const v = parseNum(m[1]);
        if (v > 100 && v < 5e7) data[tp.key] = Math.max(data[tp.key], v);
      }
    }
  }

  // Annual contribution
  const contribRxs = [
    /(?:årlig|årl\.|indbetaling|bidrag|præmie)[^0-9]{0,30}?(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)/gi,
    /(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)[^0-9]{0,20}?(?:årlig|pr\.\s*år|\/år|om året)/gi,
  ];
  for (const rx of contribRxs) {
    let m;
    while ((m = rx.exec(t)) !== null) {
      const v = parseNum(m[1]);
      if (v > 1000 && v < 500000) data.annualContribution = Math.max(data.annualContribution, v);
    }
  }

  // Total / depot value
  const totalRxs = [
    /(?:samlet|depot|i alt|total|opsparing|værdi|saldo|formue)[^0-9]{0,30}?(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)/gi,
    /(\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?)[^0-9]{0,20}?(?:samlet|i alt|total)/gi,
  ];
  for (const rx of totalRxs) {
    let m;
    while ((m = rx.exec(t)) !== null) {
      const v = parseNum(m[1]);
      if (v > 10000 && v < 1e8) data.totalSavings = Math.max(data.totalSavings, v);
    }
  }

  // Fallbacks
  if (!data.totalSavings) data.totalSavings = data.ratepension + data.livsvarig + data.aldersopsparing + data.kapitalpension;
  if (!data.totalSavings && amounts.length > 0) data.totalSavings = Math.max(...amounts.filter(a => a > 10000));
  
  return data;
}

function simulatePension(p) {
  const { currentAge:ca, retirementAge:ra, expectedReturn:er, inflation:inf, persons, propertyValue:pv, mortgage:mg, propertyAppreciation:pa, sellAtRetirement:sell, inheritanceAmount:ia, inheritanceAge:iage, inheritanceFromSpouse:ifs } = p;
  const ytr = ra - ca, rd = 90 - ra;
  const realRet = (1+er)/(1+inf)-1, afterPAL = realRet*(1-TAX.PAL_RATE);
  const propApp = pa||0.02;
  const projPV = (pv||0)*Math.pow(1+propApp,ytr);
  const mortRet = Math.max(0,(mg||0)*Math.max(0,1-ytr/30));
  const eqRet = Math.max(0, projPV - mortRet);
  const netPropProc = sell ? eqRet : 0;
  const annHousBen = sell ? 0 : eqRet*0.035;
  const inhYrs = Math.max(0,(iage||ca)-ca);
  const raw = ia||0;
  const taxInh = Math.max(0, raw - TAX.BOAFGIFT_BUNDFRADRAG);
  const ba = taxInh * TAX.BOAFGIFT_RATE;
  const netInh = ifs ? raw : raw - ba;
  const inhGrowYrs = Math.max(0, ytr - inhYrs);
  const inhAtRet = netInh * Math.pow(1+realRet, inhGrowYrs);

  const results = [], projections = [];
  for (const per of persons) {
    let sav = per.totalSavings||0, ac = per.annualContribution||0;
    const accum = [];
    for (let y=0;y<=ytr;y++) {
      let ib = (y===inhYrs && netInh>0) ? netInh/persons.length : 0;
      accum.push({year:y,age:ca+y,savings:Math.round(sav),inhEvent:ib>0});
      sav = sav*(1+afterPAL)+ac+ib;
    }
    const tot = sav, ts = per.totalSavings||1;
    const rs=per.ratepension/ts||.5, as2=per.aldersopsparing/ts||.1, ls=per.livsvarig/ts||.3, ks=per.kapitalpension/ts||.1;
    const rAmt=tot*rs, aAmt=tot*as2, lAmt=tot*ls, kAmt=tot*ks;
    const rpY=Math.min(25,rd), arP=rAmt/rpY, alP=lAmt*.045, aaP=aAmt/rd, akP=kAmt*.6/rd;
    const propInc = sell ? netPropProc/(rd*persons.length) : annHousBen/persons.length;
    const fpAge = ca<52?69:ca<55?68:67;
    const fpB=TAX.FOLKEPENSION_BASIC, fpT=persons.length>1?TAX.FOLKEPENSION_SUPPLEMENT_COUPLE:TAX.FOLKEPENSION_SUPPLEMENT;

    const decum = [];
    let rem = tot;
    for (let y=0;y<=rd;y++) {
      const age=ra+y, hr=y<rpY, hfp=age>=fpAge;
      let gi=0;
      if(hr) gi+=arP; gi+=alP+aaP+akP+propInc;
      if(hfp){gi+=fpB; const mr=Math.max(0,(arP+alP)-95000)*.309; gi+=Math.max(0,fpT-mr);}
      gi+=TAX.ATP_YEARLY;
      const ti=arP+alP+(hfp?fpB:0);
      const tx=Math.max(0,(ti-TAX.PERSONFRADRAG)*(TAX.BUNDSKAT+TAX.KOMMUNE_SKAT_AVG));
      const ts2=Math.max(0,(ti-TAX.TOPSKAT_THRESHOLD)*TAX.TOPSKAT_RATE);
      const ni=gi-tx-ts2;
      rem=rem*(1+afterPAL)-(hr?arP:0)-alP*.5;
      decum.push({year:ytr+y,age,grossIncome:Math.round(gi),netIncome:Math.round(ni),monthlyNet:Math.round(ni/12),remainingSavings:Math.round(Math.max(0,rem)),folkepension:hfp,propertyIncome:Math.round(propInc)});
    }
    results.push({name:per.name,totalAtRetirement:Math.round(tot),accumulation:accum,decumulation:decum,annualRatePayout:Math.round(arP),annualLifePayout:Math.round(alP),annualAldersPayout:Math.round(aaP),annualKapitalPayout:Math.round(akP),annualPropertyIncome:Math.round(propInc),folkepensionAge:fpAge,folkepensionBasic:Math.round(fpB),folkepensionTillaeg:Math.round(fpT),atpAnnual:TAX.ATP_YEARLY});
  }

  for (let y=0;y<=ytr+rd;y++) {
    const e={year:ca+y}; let tw=0;
    for (let i=0;i<results.length;i++){const r=results[i]; if(y<=ytr){e[`s${i}`]=r.accumulation[y]?.savings||0;e[`m${i}`]=0;tw+=e[`s${i}`];}else{const dy=y-ytr;e[`s${i}`]=r.decumulation[dy]?.remainingSavings||0;e[`m${i}`]=r.decumulation[dy]?.monthlyNet||0;tw+=e[`s${i}`];}}
    const py=Math.min(y,ytr), ppv=(pv||0)*Math.pow(1+propApp,py), pm=Math.max(0,(mg||0)*Math.max(0,1-py/30));
    e.propEq = y<=ytr ? Math.round(Math.max(0,ppv-pm)) : (sell?0:Math.round(eqRet));
    e.tw=Math.round(tw+e.propEq); e.phase=y<=ytr?"Opsparing":"Udbetaling";
    projections.push(e);
  }

  const scenarios = [er-.03,er,er+.03].map((ret,i)=>{
    const rr2=(1+ret)/(1+inf)-1, ap2=rr2*(1-TAX.PAL_RATE);
    let t=0; for(const per of persons){let s=per.totalSavings||0;for(let y=0;y<ytr;y++){let ib2=(y===inhYrs&&netInh>0)?netInh/persons.length:0;s=s*(1+ap2)+(per.annualContribution||0)+ib2;}t+=s;} t+=eqRet;
    return {label:["Pessimistisk","Forventet","Optimistisk"][i],returnRate:ret,total:Math.round(t)};
  });

  const totalPen=results.reduce((s,r)=>s+r.totalAtRetirement,0);
  const wealthPie=[
    {name:"Pensionsopsparing",value:Math.round(totalPen),color:"#3b82f6"},
    {name:"Bolig (friværdi)",value:Math.round(eqRet),color:"#10b981"},
    {name:"Arv (netto)",value:Math.round(inhAtRet>0?inhAtRet:0),color:"#f59e0b"},
    {name:"Folkepension+ATP",value:Math.round((TAX.FOLKEPENSION_BASIC+TAX.ATP_YEARLY)*rd),color:"#8b5cf6"},
  ].filter(d=>d.value>0);

  return {results,projections,scenarios,wealthPie,
    propInfo:{curEq:Math.max(0,(pv||0)-(mg||0)),eqRet:Math.round(eqRet),projVal:Math.round(projPV),mortRet:Math.round(mortRet),sell,annHousBen:Math.round(annHousBen),netProc:Math.round(netPropProc)},
    inhInfo:{gross:raw,boafgift:Math.round(ifs?0:ba),net:Math.round(netInh),atRet:Math.round(inhAtRet),recAge:iage||ca,fromSpouse:ifs}};
}
const C = { bg:"#0a0f1a",card:"#111827",border:"#1e2d3d",accent:"#3b82f6",accentLight:"#60a5fa",green:"#10b981",greenLight:"#34d399",amber:"#f59e0b",red:"#ef4444",purple:"#8b5cf6",text:"#e2e8f0",textMuted:"#94a3b8",textDim:"#64748b",surface:"#0f172a"};
const CC=["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6"];

function Card({children,style={},...props}){return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"12px",padding:"24px",...style}} {...props}>{children}</div>;}
function Inp({label,value,onChange,type="number",min,max,step,style={}}){
  return <div style={{marginBottom:"16px",...style}}><label style={{display:"block",fontSize:"13px",color:C.textMuted,marginBottom:"6px",fontWeight:500}}>{label}</label>
    <input type={type} value={value} onChange={e=>onChange(type==="number"?parseFloat(e.target.value)||0:e.target.value)} min={min} max={max} step={step}
      style={{width:"100%",padding:"10px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:"8px",color:C.text,fontSize:"15px",outline:"none",boxSizing:"border-box"}}
      onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/></div>;
}
function Sld({label,value,onChange,min,max,step=0.001}){
  return <div style={{marginBottom:"20px"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
    <label style={{fontSize:"13px",color:C.textMuted,fontWeight:500}}>{label}</label>
    <span style={{fontSize:"14px",color:C.accentLight,fontWeight:600}}>{pct(value)}</span></div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))}
      style={{width:"100%",height:"6px",appearance:"none",background:`linear-gradient(to right, ${C.accent} ${((value-min)/(max-min))*100}%, ${C.border} ${((value-min)/(max-min))*100}%)`,borderRadius:"3px",cursor:"pointer",outline:"none"}}/></div>;
}
function Tog({label,checked,onChange,sub}){
  return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
    <div><div style={{fontSize:"13px",color:C.textMuted,fontWeight:500}}>{label}</div>{sub&&<div style={{fontSize:"11px",color:C.textDim,maxWidth:"280px"}}>{sub}</div>}</div>
    <div onClick={()=>onChange(!checked)} style={{width:"44px",height:"24px",borderRadius:"12px",cursor:"pointer",background:checked?C.accent:C.border,position:"relative",flexShrink:0}}>
      <div style={{width:"18px",height:"18px",borderRadius:"50%",background:"#fff",position:"absolute",top:"3px",left:checked?"23px":"3px",transition:"left 0.2s"}}/></div></div>;
}
function Stat({label,value,sub,color=C.accent}){
  return <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"18px",borderLeft:`3px solid ${color}`}}>
    <div style={{fontSize:"12px",color:C.textDim,marginBottom:"4px",textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</div>
    <div style={{fontSize:"20px",fontWeight:700,color:C.text}}>{value}</div>
    {sub&&<div style={{fontSize:"12px",color:C.textMuted,marginTop:"4px"}}>{sub}</div>}</div>;
}
function TabBtn({active,children,onClick}){return <button onClick={onClick} style={{padding:"10px 20px",background:active?C.accent:"transparent",color:active?"#fff":C.textMuted,border:`1px solid ${active?C.accent:C.border}`,borderRadius:"8px",cursor:"pointer",fontSize:"14px",fontWeight:active?600:400}}>{children}</button>;}
function Sec({icon,title,sub}){return <div style={{marginBottom:"16px"}}><h3 style={{margin:0,fontSize:"16px",fontWeight:600,color:C.text}}>{icon} {title}</h3>{sub&&<p style={{margin:"4px 0 0",fontSize:"12px",color:C.textDim}}>{sub}</p>}</div>;}

function PersonForm({person:p,onChange,onRemove,index:i}){
  const u=(k,v)=>onChange({...p,[k]:v});
  return <Card style={{marginBottom:"16px",borderLeft:`3px solid ${CC[i]}`}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
      <h3 style={{margin:0,fontSize:"16px",color:C.text}}>{p.name||`Person ${i+1}`}</h3>
      {onRemove&&<button onClick={onRemove} style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:"13px"}}>Fjern</button>}</div>
    <Inp label="Navn" value={p.name} onChange={v=>u("name",v)} type="text"/>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
      <Inp label="Samlet opsparing (kr)" value={p.totalSavings} onChange={v=>u("totalSavings",v)} step={1000}/>
      <Inp label="Årlig indbetaling (kr)" value={p.annualContribution} onChange={v=>u("annualContribution",v)} step={1000}/></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
      <Inp label="Ratepension (kr)" value={p.ratepension} onChange={v=>u("ratepension",v)} step={1000}/>
      <Inp label="Livsvarig pension (kr)" value={p.livsvarig} onChange={v=>u("livsvarig",v)} step={1000}/></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
      <Inp label="Aldersopsparing (kr)" value={p.aldersopsparing} onChange={v=>u("aldersopsparing",v)} step={1000}/>
      <Inp label="Kapitalpension (kr)" value={p.kapitalpension} onChange={v=>u("kapitalpension",v)} step={1000}/></div>
    {p.provider&&<div style={{marginTop:"8px",fontSize:"12px",color:C.textDim}}>Udbyder: <span style={{color:C.accentLight}}>{p.provider}</span></div>}
  </Card>;
}
export default function DanskPensionSimulator() {
  const [tab, setTab] = useState("input");
  const [currentAge, setCurrentAge] = useState(40);
  const [retirementAge, setRetirementAge] = useState(67);
  const [expectedReturn, setExpectedReturn] = useState(0.06);
  const [inflation, setInflation] = useState(0.02);
  const [persons, setPersons] = useState([{name:"Mig",totalSavings:800000,annualContribution:60000,ratepension:400000,livsvarig:200000,aldersopsparing:120000,kapitalpension:80000,provider:""}]);
  const [propertyValue, setPropertyValue] = useState(3500000);
  const [mortgage, setMortgage] = useState(2000000);
  const [propertyAppreciation, setPropertyAppreciation] = useState(0.02);
  const [sellAtRetirement, setSellAtRetirement] = useState(false);
  const [includeProperty, setIncludeProperty] = useState(true);
  const [inheritanceAmount, setInheritanceAmount] = useState(0);
  const [inheritanceAge, setInheritanceAge] = useState(55);
  const [inheritanceFromSpouse, setInheritanceFromSpouse] = useState(false);
  const [includeInheritance, setIncludeInheritance] = useState(false);
  const [simulation, setSimulation] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseStatus, setParseStatus] = useState("");
  const fileInputRef = useRef(null);

  const loadPdfJs = useCallback(async () => {
    if (window.pdfjsLib) return window.pdfjsLib;
    return new Promise((resolve, reject) => {
      if (document.getElementById('pdfjs-script')) {
        const check = setInterval(() => { if (window.pdfjsLib) { clearInterval(check); resolve(window.pdfjsLib); } }, 100);
        return;
      }
      const script = document.createElement('script');
      script.id = 'pdfjs-script';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }, []);

  const extractTextFromPdf = useCallback(async (file) => {
    const pdfjsLib = await loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  }, [loadPdfJs]);

  const applyPensionData = useCallback((data) => {
    setPersons(prev => {
      const u = [...prev], t = u[0];
      if (data.totalSavings > 0) t.totalSavings = data.totalSavings;
      if (data.annualContribution > 0) t.annualContribution = data.annualContribution;
      if (data.ratepension > 0) t.ratepension = data.ratepension;
      if (data.livsvarig > 0) t.livsvarig = data.livsvarig;
      if (data.aldersopsparing > 0) t.aldersopsparing = data.aldersopsparing;
      if (data.kapitalpension > 0) t.kapitalpension = data.kapitalpension;
      if (data.provider) t.provider = data.provider;
      return u;
    });
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    setParseStatus(isPdf ? "📄 Læser PDF — vent venligst..." : "Læser fil...");
    try {
      let text;
      if (isPdf) {
        text = await extractTextFromPdf(file);
      } else {
        text = await file.text();
      }
      const data = extractPensionData(text);
      applyPensionData(data);
      if (data.totalSavings > 0) {
        const parts = [];
        if (data.ratepension > 0) parts.push(`Rate: ${fmt(data.ratepension)}`);
        if (data.livsvarig > 0) parts.push(`Livsvarig: ${fmt(data.livsvarig)}`);
        if (data.aldersopsparing > 0) parts.push(`Alder: ${fmt(data.aldersopsparing)}`);
        if (data.kapitalpension > 0) parts.push(`Kapital: ${fmt(data.kapitalpension)}`);
        setParseStatus(`✓ Fandt pensionsdata: ${fmt(data.totalSavings)} samlet${data.provider ? ` (${data.provider})` : ''}${parts.length ? '\n   ' + parts.join(' · ') : ''}`);
      } else {
        setParseStatus("⚠ Kunne ikke finde beløb automatisk. Prøv at udfylde manuelt. Tip: Hent din rapport fra pensionsinfo.dk som PDF.");
      }
    } catch (err) {
      console.error('File parse error:', err);
      setParseStatus("⚠ Kunne ikke læse filen. Understøtter PDF, tekst og CSV fra PensionInfo.");
    }
  }, [extractTextFromPdf, applyPensionData]);
  const handleDrop = useCallback(e=>{e.preventDefault();setDragOver(false);if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0]);},[handleFile]);

  const runSimulation = () => {
    const r = simulatePension({currentAge,retirementAge,expectedReturn,inflation,persons,
      propertyValue:includeProperty?propertyValue:0,mortgage:includeProperty?mortgage:0,
      propertyAppreciation:includeProperty?propertyAppreciation:0,sellAtRetirement:includeProperty?sellAtRetirement:false,
      inheritanceAmount:includeInheritance?inheritanceAmount:0,inheritanceAge:includeInheritance?inheritanceAge:currentAge,
      inheritanceFromSpouse:includeInheritance?inheritanceFromSpouse:false});
    setSimulation(r);setTab("results");
  };

  const addPerson=()=>setPersons([...persons,{name:"Ægtefælle",totalSavings:0,annualContribution:0,ratepension:0,livsvarig:0,aldersopsparing:0,kapitalpension:0,provider:""}]);
  const removePerson=i=>{if(persons.length>1)setPersons(persons.filter((_,j)=>j!==i));};
  const updatePerson=(i,d)=>setPersons(persons.map((p,j)=>j===i?d:p));
  const totalSavings=persons.reduce((s,p)=>s+(p.totalSavings||0),0);
  const totalContrib=persons.reduce((s,p)=>s+(p.annualContribution||0),0);
  const currentEquity=includeProperty?Math.max(0,propertyValue-mortgage):0;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');*{box-sizing:border-box}input[type="range"]::-webkit-slider-thumb{appearance:none;width:18px;height:18px;border-radius:50%;background:${C.accent};cursor:pointer;border:2px solid #fff}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:${C.surface}}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}`}</style>

      {/* HEADER */}
      <div style={{background:`linear-gradient(135deg,${C.surface},${C.bg})`,borderBottom:`1px solid ${C.border}`,padding:"24px 32px"}}>
        <div style={{maxWidth:"1200px",margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"4px"}}>
            <div style={{width:"36px",height:"36px",borderRadius:"10px",background:`linear-gradient(135deg,${C.accent},${C.green})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px"}}>🏦</div>
            <h1 style={{margin:0,fontSize:"22px",fontWeight:700,letterSpacing:"-0.5px"}}>Dansk Pensionssimulator</h1></div>
          <p style={{margin:"6px 0 0 48px",fontSize:"13px",color:C.textDim}}>Pension, boligformue og arv — samlet overblik</p>
          <div style={{display:"flex",gap:"8px",marginTop:"20px",flexWrap:"wrap"}}>
            <TabBtn active={tab==="input"} onClick={()=>setTab("input")}>📋 Indtastning</TabBtn>
            <TabBtn active={tab==="results"} onClick={()=>setTab("results")}>📊 Resultater</TabBtn>
            <TabBtn active={tab==="breakdown"} onClick={()=>setTab("breakdown")}>📑 Detaljer</TabBtn>
            <TabBtn active={tab==="info"} onClick={()=>setTab("info")}>ℹ️ Om regler</TabBtn></div>
        </div></div>

      <div style={{maxWidth:"1200px",margin:"0 auto",padding:"24px 32px"}}>

      {/* ═══ INPUT ═══ */}
      {tab==="input"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"24px"}}>
          <div>
            <Card style={{marginBottom:"20px",border:dragOver?`2px dashed ${C.accent}`:`1px dashed ${C.border}`,cursor:"pointer",textAlign:"center"}}
              onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={handleDrop} onClick={()=>fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept=".pdf,.txt,.csv,.xml,.json" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
              <div style={{fontSize:"32px",marginBottom:"8px"}}>📄</div>
              <div style={{fontSize:"14px",color:C.text,fontWeight:500}}>Træk pensionsrapport hertil (PDF)</div>
              <div style={{fontSize:"12px",color:C.textDim,marginTop:"4px"}}>Understøtter PDF, tekst og CSV fra PensionInfo</div></Card>
            {parseStatus&&<div style={{padding:"12px 16px",background:`${C.amber}15`,border:`1px solid ${C.amber}40`,borderRadius:"8px",fontSize:"13px",color:C.amber,marginBottom:"16px"}}>{parseStatus}</div>}
            {persons.map((p,i)=><PersonForm key={i} index={i} person={p} onChange={d=>updatePerson(i,d)} onRemove={persons.length>1?()=>removePerson(i):null}/>)}
            {persons.length<2&&<button onClick={addPerson} style={{width:"100%",padding:"12px",background:"transparent",border:`1px dashed ${C.border}`,borderRadius:"8px",color:C.textMuted,cursor:"pointer",fontSize:"14px"}}>+ Tilføj ægtefælle/partner</button>}
          </div>
          <div>
            <Card><Sec icon="⚙️" title="Forudsætninger"/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
                <Inp label="Nuværende alder" value={currentAge} onChange={setCurrentAge} min={18} max={75}/>
                <Inp label="Ønsket pensionsalder" value={retirementAge} onChange={setRetirementAge} min={60} max={75}/></div>
              <Sld label="Forventet årligt afkast" value={expectedReturn} onChange={setExpectedReturn} min={0.01} max={0.12} step={0.005}/>
              <Sld label="Forventet inflation" value={inflation} onChange={setInflation} min={0} max={0.06} step={0.005}/>
              <div style={{background:C.surface,borderRadius:"8px",padding:"14px",marginTop:"8px"}}>
                <div style={{fontSize:"12px",color:C.textDim,marginBottom:"4px"}}>Realt afkast efter PAL-skat</div>
                <div style={{fontSize:"18px",fontWeight:700,color:C.greenLight}}>{pct(((1+expectedReturn)/(1+inflation)-1)*(1-TAX.PAL_RATE))}</div>
                <div style={{fontSize:"11px",color:C.textDim,marginTop:"4px"}}>= ({pct(expectedReturn)} − {pct(inflation)}) × (1 − {pct(TAX.PAL_RATE)} PAL)</div></div>
            </Card>

            {/* BOLIG */}
            <Card style={{marginTop:"16px"}}><Sec icon="🏠" title="Boligformue" sub="Friværdi i ejerbolig"/>
              <Tog label="Medtag boligformue" checked={includeProperty} onChange={setIncludeProperty}/>
              {includeProperty&&<>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
                  <Inp label="Boligværdi (kr)" value={propertyValue} onChange={setPropertyValue} step={50000}/>
                  <Inp label="Restgæld (kr)" value={mortgage} onChange={setMortgage} step={50000}/></div>
                <Sld label="Forventet boligprisstigning" value={propertyAppreciation} onChange={setPropertyAppreciation} min={0} max={0.06} step={0.005}/>
                <Tog label="Sælg bolig ved pensionering" checked={sellAtRetirement} onChange={setSellAtRetirement} sub={sellAtRetirement?"Friværdi omsættes til kontant formue":"Beholdes — sparet husleje som indkomst"}/>
                <div style={{background:C.surface,borderRadius:"8px",padding:"14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <div><div style={{fontSize:"12px",color:C.textDim}}>Nuværende friværdi</div><div style={{fontSize:"18px",fontWeight:700,color:C.greenLight}}>{fmt(currentEquity)}</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:"12px",color:C.textDim}}>Ejerandel</div><div style={{fontSize:"18px",fontWeight:700,color:C.text}}>{propertyValue>0?pct(currentEquity/propertyValue):"0%"}</div></div></div></div>
              </>}
            </Card>

            {/* ARV */}
            <Card style={{marginTop:"16px"}}><Sec icon="📜" title="Forventet arv" sub="Arv du forventer at modtage"/>
              <Tog label="Medtag forventet arv" checked={includeInheritance} onChange={setIncludeInheritance}/>
              {includeInheritance&&<>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
                  <Inp label="Forventet arvebeløb (kr)" value={inheritanceAmount} onChange={setInheritanceAmount} step={50000}/>
                  <Inp label="Forventet alder ved arv" value={inheritanceAge} onChange={setInheritanceAge} min={currentAge} max={90}/></div>
                <Tog label="Arv fra ægtefælle" checked={inheritanceFromSpouse} onChange={setInheritanceFromSpouse} sub={inheritanceFromSpouse?"Ingen boafgift mellem ægtefæller":`15% boafgift over ${fmt(TAX.BOAFGIFT_BUNDFRADRAG)}`}/>
                {inheritanceAmount>0&&<div style={{background:C.surface,borderRadius:"8px",padding:"14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <div><div style={{fontSize:"12px",color:C.textDim}}>Brutto</div><div style={{fontSize:"16px",fontWeight:600,color:C.text}}>{fmt(inheritanceAmount)}</div></div>
                    <div style={{textAlign:"center"}}><div style={{fontSize:"12px",color:C.textDim}}>Boafgift</div><div style={{fontSize:"16px",fontWeight:600,color:C.red}}>{inheritanceFromSpouse?fmt(0):fmt(Math.max(0,inheritanceAmount-TAX.BOAFGIFT_BUNDFRADRAG)*TAX.BOAFGIFT_RATE)}</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:"12px",color:C.textDim}}>Netto</div><div style={{fontSize:"16px",fontWeight:600,color:C.greenLight}}>{fmt(inheritanceFromSpouse?inheritanceAmount:inheritanceAmount-Math.max(0,inheritanceAmount-TAX.BOAFGIFT_BUNDFRADRAG)*TAX.BOAFGIFT_RATE)}</div></div></div></div>}
              </>}
            </Card>

            {/* OVERBLIK */}
            <Card style={{marginTop:"16px"}}><Sec icon="📊" title="Samlet overblik"/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
                <Stat label="Pensionsopsparing" value={fmt(totalSavings)} color={C.accent}/>
                <Stat label="Årlig indbetaling" value={fmt(totalContrib)} color={C.green}/>
                <Stat label="Bolig friværdi" value={fmt(currentEquity)} sub={includeProperty?"Medtaget":"Ikke medtaget"} color={C.green}/>
                <Stat label="År til pension" value={`${retirementAge-currentAge} år`} color={C.amber}/></div>
            </Card>

            <button onClick={runSimulation} style={{width:"100%",marginTop:"20px",padding:"16px",background:`linear-gradient(135deg,${C.accent},#2563eb)`,color:"#fff",border:"none",borderRadius:"10px",fontSize:"16px",fontWeight:600,cursor:"pointer",boxShadow:`0 4px 20px ${C.accent}40`}}>🚀 Beregn pension</button>
          </div>
        </div>
      )}
      {/* ═══ RESULTS ═══ */}
      {tab==="results"&&simulation&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"16px",marginBottom:"24px"}}>
            {simulation.results.map((r,i)=><Stat key={i} label={`${r.name} — pension`} value={fmt(r.totalAtRetirement)} sub={`${retirementAge-currentAge} års opsparing`} color={CC[i]}/>)}
            {simulation.propInfo.eqRet>0&&<Stat label="Bolig friværdi ved pension" value={fmt(simulation.propInfo.eqRet)} sub={simulation.propInfo.sell?"Sælges":"Beholdes — sparet husleje"} color={C.green}/>}
            {simulation.inhInfo.net>0&&<Stat label="Arv (netto)" value={fmt(simulation.inhInfo.atRet)} sub={`Modtages ${simulation.inhInfo.recAge} år${simulation.inhInfo.boafgift>0?` · ${fmt(simulation.inhInfo.boafgift)} boafgift`:""}`} color={C.amber}/>}
            <Stat label="Månedlig udbetaling" value={fmt(simulation.results[0]?.decumulation[0]?.monthlyNet||0)} sub="Netto/md (første år)" color={C.purple}/>
            <Stat label="Folkepension fra" value={`${simulation.results[0]?.folkepensionAge} år`} sub={`+ ${fmt(simulation.results[0]?.folkepensionBasic||0)}/år`} color={C.textDim}/>
          </div>

          {/* PIE CHART */}
          {simulation.wealthPie.length>1&&<Card style={{marginBottom:"24px"}}>
            <Sec icon="🥧" title="Formuesammensætning ved pensionering"/>
            <div style={{display:"flex",alignItems:"center",gap:"32px"}}>
              <ResponsiveContainer width="50%" height={250}><PieChart><Pie data={simulation.wealthPie} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" paddingAngle={3}>
                {simulation.wealthPie.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie>
                <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"8px",color:C.text}} formatter={v=>fmt(v)}/></PieChart></ResponsiveContainer>
              <div style={{flex:1}}>
                {simulation.wealthPie.map((d,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px"}}>
                  <div style={{width:"12px",height:"12px",borderRadius:"3px",background:d.color,flexShrink:0}}/>
                  <div style={{flex:1}}><div style={{fontSize:"13px",color:C.text}}>{d.name}</div><div style={{fontSize:"15px",fontWeight:600}}>{fmt(d.value)}</div></div>
                  <div style={{fontSize:"13px",color:C.textDim}}>{pct(d.value/simulation.wealthPie.reduce((s,x)=>s+x.value,0))}</div></div>)}
                <div style={{borderTop:`1px solid ${C.border}`,paddingTop:"10px",marginTop:"4px"}}>
                  <div style={{fontSize:"13px",color:C.textDim}}>Samlet formue</div>
                  <div style={{fontSize:"20px",fontWeight:700,color:C.greenLight}}>{fmt(simulation.wealthPie.reduce((s,x)=>s+x.value,0))}</div></div>
              </div></div></Card>}

          {/* SCENARIOS */}
          <Card style={{marginBottom:"24px"}}><Sec icon="🎯" title="Scenarier — samlet formue" sub="Inkl. pension, bolig og arv"/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"16px"}}>
              {simulation.scenarios.map((s,i)=><div key={i} style={{background:C.surface,borderRadius:"10px",padding:"20px",textAlign:"center",border:i===1?`2px solid ${C.accent}`:`1px solid ${C.border}`}}>
                <div style={{fontSize:"13px",color:C.textDim,marginBottom:"4px"}}>{s.label}</div>
                <div style={{fontSize:"11px",color:C.textMuted,marginBottom:"8px"}}>Afkast: {pct(s.returnRate)}/år</div>
                <div style={{fontSize:"24px",fontWeight:700,color:[C.red,C.green,C.greenLight][i]}}>{fmt(s.total)}</div></div>)}</div></Card>

          {/* WEALTH CHART */}
          <Card style={{marginBottom:"24px"}}><Sec icon="📈" title="Samlet formueudvikling" sub="Pension + bolig over tid"/>
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={simulation.projections} margin={{top:10,right:30,left:20,bottom:5}}>
                <defs><linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.accent} stopOpacity={0.3}/><stop offset="100%" stopColor={C.accent} stopOpacity={0.02}/></linearGradient>
                  <linearGradient id="gH" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.green} stopOpacity={0.3}/><stop offset="100%" stopColor={C.green} stopOpacity={0.02}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="year" stroke={C.textDim} fontSize={12}/><YAxis stroke={C.textDim} fontSize={12} tickFormatter={fmtShort}/>
                <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"8px",color:C.text}} formatter={(v,n)=>[fmt(v),n]} labelFormatter={v=>`Alder: ${v} år`}/>
                <ReferenceLine x={retirementAge} stroke={C.amber} strokeDasharray="5 5" label={{value:"Pension",fill:C.amber,fontSize:12}}/>
                {simulation.results.map((_,i)=><Area key={i} type="monotone" dataKey={`s${i}`} stroke={CC[i]} fill="url(#gP)" strokeWidth={2} name={`Pension ${simulation.results[i]?.name}`} stackId="w"/>)}
                {simulation.propInfo.eqRet>0&&<Area type="monotone" dataKey="propEq" stroke={C.green} fill="url(#gH)" strokeWidth={2} name="Bolig friværdi" stackId="w"/>}
              </AreaChart></ResponsiveContainer></Card>

          {/* MONTHLY PAYOUT */}
          <Card><Sec icon="💰" title="Månedlig udbetaling efter skat" sub="Inkl. alle indkomstkilder"/>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={simulation.projections.filter(p=>p.phase==="Udbetaling")} margin={{top:10,right:30,left:20,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="year" stroke={C.textDim} fontSize={12}/><YAxis stroke={C.textDim} fontSize={12} tickFormatter={fmtShort}/>
                <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"8px",color:C.text}} formatter={v=>[fmt(v),"Netto/md"]} labelFormatter={v=>`Alder: ${v} år`}/>
                {simulation.results.map((_,i)=><Bar key={i} dataKey={`m${i}`} fill={CC[i]} radius={[4,4,0,0]} name={simulation.results[i]?.name}/>)}
              </BarChart></ResponsiveContainer></Card>
        </div>
      )}

      {/* ═══ BREAKDOWN ═══ */}
      {tab==="breakdown"&&simulation&&(
        <div>
          {simulation.propInfo.eqRet>0&&<Card style={{marginBottom:"24px"}}><Sec icon="🏠" title="Boligformue — detaljer"/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px",marginBottom:"16px"}}>
              <Stat label="Boligværdi ved pension" value={fmt(simulation.propInfo.projVal)} color={C.green}/>
              <Stat label="Restgæld ved pension" value={fmt(simulation.propInfo.mortRet)} color={C.red}/>
              <Stat label="Friværdi ved pension" value={fmt(simulation.propInfo.eqRet)} color={C.greenLight}/></div>
            <div style={{background:C.surface,borderRadius:"8px",padding:"14px",fontSize:"13px",color:C.textMuted}}>
              {simulation.propInfo.sell
                ? <>Ved salg frigøres <strong style={{color:C.greenLight}}>{fmt(simulation.propInfo.netProc)}</strong> kontant. Ejerbolig er normalt skattefri pga. parcelhusreglen.</>
                : <>Beholdes — sparet husleje svarer til ca. <strong style={{color:C.greenLight}}>{fmt(simulation.propInfo.annHousBen)}/år</strong> ({fmt(Math.round(simulation.propInfo.annHousBen/12))}/md) i implicit indkomst.</>}
            </div></Card>}

          {simulation.inhInfo.gross>0&&<Card style={{marginBottom:"24px"}}><Sec icon="📜" title="Arv — detaljer"/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px",marginBottom:"16px"}}>
              <Stat label="Brutto arv" value={fmt(simulation.inhInfo.gross)} color={C.amber}/>
              <Stat label="Boafgift (15%)" value={fmt(simulation.inhInfo.boafgift)} sub={simulation.inhInfo.fromSpouse?"Fritaget":"Over bundfradrag"} color={C.red}/>
              <Stat label="Netto arv" value={fmt(simulation.inhInfo.net)} color={C.greenLight}/></div>
            <div style={{background:C.surface,borderRadius:"8px",padding:"14px",fontSize:"13px",color:C.textMuted}}>
              Modtages ved alder <strong style={{color:C.text}}>{simulation.inhInfo.recAge}</strong>. Estimeret værdi ved pension: <strong style={{color:C.greenLight}}>{fmt(simulation.inhInfo.atRet)}</strong>.
              {simulation.inhInfo.fromSpouse&&" Arv mellem ægtefæller er fritaget for boafgift."}</div></Card>}

          {simulation.results.map((r,idx)=><Card key={idx} style={{marginBottom:"24px"}}>
            <h3 style={{margin:"0 0 20px",fontSize:"18px",fontWeight:600,color:CC[idx]}}>{r.name} — Pensionsdetaljer</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px",marginBottom:"20px"}}>
              <Stat label="Total ved pension" value={fmt(r.totalAtRetirement)} color={CC[idx]}/>
              <Stat label="Folkepension/år" value={fmt(r.folkepensionBasic)} sub={`Fra ${r.folkepensionAge} år`} color={C.green}/>
              <Stat label="ATP/år" value={fmt(r.atpAnnual)} color={C.textDim}/></div>

            <h4 style={{fontSize:"14px",color:C.textMuted,margin:"16px 0 12px",fontWeight:500}}>Årlig pensionsudbetaling</h4>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:"12px"}}>
              {[{l:"Ratepension",v:r.annualRatePayout,s:"Over 10-25 år, beskattes"},{l:"Livsvarig pension",v:r.annualLifePayout,s:"Livsvarig livrente"},{l:"Aldersopsparing",v:r.annualAldersPayout,s:"✓ Skattefri"},{l:"Kapitalpension",v:r.annualKapitalPayout,s:"40% afgift"}].map((x,i)=>
                <div key={i} style={{background:C.surface,borderRadius:"8px",padding:"14px"}}>
                  <div style={{fontSize:"12px",color:C.textDim}}>{x.l}</div>
                  <div style={{fontSize:"16px",fontWeight:600,color:C.text}}>{fmt(x.v)}/år</div>
                  <div style={{fontSize:"11px",color:x.s.includes("✓")?C.greenLight:C.textMuted}}>{x.s}</div></div>)}</div>

            {r.annualPropertyIncome>0&&<div style={{marginTop:"12px",background:`${C.green}10`,border:`1px solid ${C.green}30`,borderRadius:"8px",padding:"14px"}}>
              <div style={{fontSize:"12px",color:C.greenLight,fontWeight:500}}>{simulation.propInfo.sell?"Boligsalg — årlig andel":"Sparet husleje"}</div>
              <div style={{fontSize:"16px",fontWeight:600,color:C.text}}>{fmt(r.annualPropertyIncome)}/år</div></div>}

            <div style={{marginTop:"12px",background:`${C.green}10`,border:`1px solid ${C.green}30`,borderRadius:"8px",padding:"14px"}}>
              <div style={{fontSize:"12px",color:C.greenLight,fontWeight:500}}>Pensionstillæg</div>
              <div style={{fontSize:"16px",fontWeight:600,color:C.text}}>Op til {fmt(r.folkepensionTillaeg)}/år</div>
              <div style={{fontSize:"11px",color:C.textMuted,marginTop:"4px"}}>Modregnes 30,9% af privat pensionsindkomst</div></div>

            <h4 style={{fontSize:"14px",color:C.textMuted,margin:"24px 0 12px",fontWeight:500}}>Udbetalingsoversigt — første 15 år</h4>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                {["Alder","Brutto/år","Netto/år","Netto/md","Bolig","Restopspar.","Folkep."].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"right",color:C.textDim,fontWeight:500,fontSize:"11px"}}>{h}</th>)}</tr></thead>
              <tbody>{r.decumulation.slice(0,15).map((row,i)=><tr key={i} style={{borderBottom:`1px solid ${C.border}22`,background:i%2?`${C.surface}50`:"transparent"}}>
                <td style={{padding:"8px 12px",textAlign:"right",color:C.text}}>{row.age}</td>
                <td style={{padding:"8px 12px",textAlign:"right",color:C.text}}>{fmt(row.grossIncome)}</td>
                <td style={{padding:"8px 12px",textAlign:"right",color:C.greenLight,fontWeight:500}}>{fmt(row.netIncome)}</td>
                <td style={{padding:"8px 12px",textAlign:"right",color:C.amber,fontWeight:600}}>{fmt(row.monthlyNet)}</td>
                <td style={{padding:"8px 12px",textAlign:"right",color:C.green}}>{row.propertyIncome>0?fmt(row.propertyIncome):"—"}</td>
                <td style={{padding:"8px 12px",textAlign:"right",color:C.textMuted}}>{fmt(row.remainingSavings)}</td>
                <td style={{padding:"8px 12px",textAlign:"right"}}>{row.folkepension?<span style={{color:C.greenLight}}>✓</span>:<span style={{color:C.textDim}}>—</span>}</td>
              </tr>)}</tbody></table></div>
          </Card>)}
        </div>
      )}

      {/* ═══ INFO ═══ */}
      {tab==="info"&&(
        <div style={{maxWidth:"760px"}}>
          <Card style={{marginBottom:"20px"}}>
            <h3 style={{margin:"0 0 16px",fontSize:"18px",fontWeight:600}}>🇩🇰 Danske pensionsregler (2025)</h3>
            <div style={{lineHeight:"1.7",color:C.textMuted,fontSize:"14px"}}>
              <p style={{marginBottom:"16px"}}>Estimater baseret på gældende dansk lovgivning. Bør ikke erstatte professionel rådgivning.</p>
              {[
                {t:"Pensionstyper",items:[
                  {c:C.accent,l:"Ratepension",d:"Udbetales over 10-30 år. Max fradrag 63.100 kr/år. Beskattes som personlig indkomst."},
                  {c:C.green,l:"Livsvarig (livrente)",d:"Udbetales livsvarigt. Intet loft. Beskattes som personlig indkomst."},
                  {c:C.amber,l:"Aldersopsparing",d:"Max 5.700 kr/år. Skattefri udbetaling."},
                  {c:C.red,l:"Kapitalpension",d:"Lukket siden 2013. 40% afgift ved udbetaling."}]},
                {t:"Skatteregler",items:[
                  {l:"PAL-skat",d:`${pct(TAX.PAL_RATE)} af afkast i pensionsordninger.`},
                  {l:"Bundskat",d:`${pct(TAX.BUNDSKAT)} over personfradrag (${fmt(TAX.PERSONFRADRAG)}).`},
                  {l:"Kommuneskat",d:`Gennemsnit ${pct(TAX.KOMMUNE_SKAT_AVG)}.`},
                  {l:"Topskat",d:`${pct(TAX.TOPSKAT_RATE)} over ${fmt(TAX.TOPSKAT_THRESHOLD)}.`}]},
                {t:"🏠 Bolig i pensionsberegning",items:[
                  {c:C.green,l:"Friværdi",d:"Boligværdi minus restgæld. Kan frigøres ved salg eller give implicit indkomst."},
                  {l:"Parcelhusreglen",d:"Ejerbolig med fast bopæl er skattefri ved salg."},
                  {l:"Ejendomsværdiskat",d:"0,92% op til 3.040.000 kr, 3% derover (nye vurderinger fra 2024)."},
                  {l:"Sparet husleje",d:"Ca. 3,5% af friværdi årligt som implicit indkomst."}]},
                {t:"📜 Arv og boafgift",items:[
                  {c:C.amber,l:"Boafgift",d:`15% over bundfradrag (${fmt(TAX.BOAFGIFT_BUNDFRADRAG)}) for nærmeste familie.`},
                  {l:"Ægtefæller",d:"Helt fritaget for boafgift."},
                  {l:"Tillægsboafgift",d:"Yderligere 25% for fjernere arvinger (samlet op til 36,25%)."},
                  {l:"Pensionsarv",d:"Afhænger af type. Ratepension: 40% engangsskat. Livrente: kan evt. videreføres."}]},
                {t:"Folkepension",items:[
                  {l:"Alder",d:"67-69 år afhængig af fødselsår."},
                  {l:"Grundbeløb",d:`${fmt(TAX.FOLKEPENSION_BASIC)}/år.`},
                  {l:"Pensionstillæg",d:`Op til ${fmt(TAX.FOLKEPENSION_SUPPLEMENT)}/år (enlig) / ${fmt(TAX.FOLKEPENSION_SUPPLEMENT_COUPLE)}/år (par). Modregnes 30,9%.`}]},
                {t:"ATP",items:[{l:"Tillægspension",d:`Obligatorisk. Fuld: ca. ${fmt(TAX.ATP_YEARLY*5)}/år.`}]},
              ].map((sec,si)=><div key={si} style={{background:C.surface,borderRadius:"8px",padding:"16px",marginBottom:"16px"}}>
                <h4 style={{margin:"0 0 8px",color:C.text,fontSize:"15px"}}>{sec.t}</h4>
                <div style={{fontSize:"13px"}}>{sec.items.map((it,ii)=><p key={ii}><strong style={{color:it.c||C.text}}>{it.l}:</strong> {it.d}</p>)}</div></div>)}
            </div>
          </Card>
          <Card><h4 style={{margin:"0 0 12px",fontSize:"15px",fontWeight:600,color:C.amber}}>⚠️ Vigtige forbehold</h4>
            <div style={{fontSize:"13px",color:C.textMuted,lineHeight:"1.6"}}>
              <p>Estimater baseret på forenklede beregninger. Faktiske resultater afhænger af skatteforhold, kommune, civilstand, boligmarked og markedsudvikling.</p>
              <p style={{marginTop:"8px"}}>Boligværdier bruger konstant årlig stigning. Arvebeløb er estimater. Kontakt pensionsudbyder eller rådgiver for præcise tal.</p>
              <p style={{marginTop:"8px",color:C.textDim}}>Satser og grænser er 2025-niveauer.</p></div></Card>
        </div>
      )}

      {(tab==="results"||tab==="breakdown")&&!simulation&&(
        <Card style={{textAlign:"center",padding:"60px"}}>
          <div style={{fontSize:"48px",marginBottom:"16px"}}>📊</div>
          <h3 style={{margin:"0 0 8px",fontSize:"18px",color:C.text}}>Ingen beregning endnu</h3>
          <p style={{color:C.textMuted,fontSize:"14px",marginBottom:"20px"}}>Udfyld pensionsoplysninger og tryk "Beregn pension".</p>
          <button onClick={()=>setTab("input")} style={{padding:"10px 24px",background:C.accent,color:"#fff",border:"none",borderRadius:"8px",cursor:"pointer",fontSize:"14px"}}>Gå til indtastning →</button>
        </Card>
      )}
      </div>
      <div style={{marginTop:"40px",padding:"20px 32px",borderTop:`1px solid ${C.border}`,textAlign:"center",fontSize:"11px",color:C.textDim}}>Dansk Pensionssimulator — pension, bolig og arv — dansk lovgivning (2025). Kun informationsformål.</div>
    </div>
  );
}
