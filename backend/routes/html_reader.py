"""
HTML reader export.

Creates a fully self-contained HTML file with embedded images and a built-in
manga/webtoon reader. No external dependencies — opens in any browser.

Job-based flow (same store as download.py):
  1. POST /api/manga/{id}/download/html  {chapter_ids: [1,2,3]}
     → returns {job_id}
  2. GET  /api/jobs/{job_id}             → {status, stage, progress}
  3. GET  /api/jobs/{job_id}/file        → streams the .html file
"""
import base64
import io
import json
import logging
import threading

import requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from ratelimit import limiter

from auth import CurrentUser

from routes.download import (
    _gql, _fetch_pages, _safe_filename,
    _jobs, _jobs_lock, _set_job, _cleanup_old_jobs,
    SUWAYOMI,
)

import time
import uuid

router = APIRouter(tags=["html-reader"])  # shares the job store with download.py, not its router
log   = logging.getLogger(__name__)

_WEBTOON_RATIO = 2.0
_MAX_WIDTH_WT  = 800    # webtoon strip max width px
_MAX_WIDTH_MG  = 1200   # manga page max width px
_JPEG_QUALITY  = 78

# ── image helpers ─────────────────────────────────────────────────────────────

def _compress_image(raw: bytes, max_width: int) -> tuple[bytes, str]:
    """Resize + JPEG compress. Returns (bytes, mime)."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        w, h = img.size
        if w > max_width:
            h = int(h * max_width / w)
            w = max_width
            img = img.resize((w, h), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
        return buf.getvalue(), "image/jpeg"
    except Exception:
        return raw, "image/jpeg"


def _to_data_uri(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def _is_webtoon_bytes(raw: bytes) -> bool:
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        w, h = img.size
        return w > 0 and (h / w) > _WEBTOON_RATIO
    except Exception:
        return False


# ── chapter info helpers ──────────────────────────────────────────────────────

def _chapter_info_bulk(chapter_ids: list[int]) -> dict[int, dict]:
    """Return {chapter_id: {title, chapterNumber, mangaTitle}} for all IDs."""
    out = {}
    for cid in chapter_ids:
        res = _gql("""
            query CI($id: Int!) {
                chapter(id: $id) { id name chapterNumber manga { title } }
            }
        """, {"id": cid})
        ch = (res.get("data") or {}).get("chapter")
        if ch:
            n = ch.get("chapterNumber", 0)
            label = str(int(n)) if n == int(n) else str(n)
            title = ch.get("name") or f"Chapter {label}"
            out[cid] = {
                "title":       title,
                "chapterNum":  label,
                "mangaTitle":  ch["manga"]["title"],
            }
    return out


# ── HTML template ─────────────────────────────────────────────────────────────

_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=5">
<title>PLACEHOLDER_TITLE</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--sur:#111;--bdr:#222;--txt:#eee;--muted:#666;--acc:#f97316}
body{background:var(--bg);color:var(--txt);font-family:system-ui,sans-serif;height:100dvh;overflow:hidden;-webkit-text-size-adjust:100%}
#bar{position:fixed;inset:0 0 auto 0;z-index:200;background:#111c;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px;padding:10px 14px;transition:transform .25s,opacity .25s}
#bar.hide{transform:translateY(-100%);opacity:0;pointer-events:none}
#bar-menu{width:32px;height:32px;border-radius:8px;border:1px solid var(--bdr);background:var(--sur);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#bar-title{flex:1;font-size:13px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#bar-pg{font-size:12px;color:var(--muted);flex-shrink:0;font-variant-numeric:tabular-nums}
#strip{position:fixed;bottom:0;left:0;right:0;height:3px;background:var(--bdr);z-index:200;pointer-events:none}
#strip-f{height:100%;background:var(--acc);transition:width .3s ease-out}
#drawer{position:fixed;inset:0;z-index:300;background:#0009;display:none}
#drawer.open{display:flex}
#dpanel{background:var(--bg);border-right:1px solid var(--bdr);width:min(300px,82vw);overflow-y:auto;display:flex;flex-direction:column}
#dhead{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--bdr)}
#dhead h2{font-size:14px;font-weight:700;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:200px}
#dclose{background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;line-height:1;padding:4px 6px}
.ch-btn{display:block;width:100%;text-align:left;padding:12px 16px;background:none;border:none;border-bottom:1px solid var(--bdr);color:var(--muted);cursor:pointer;font-size:13px;transition:background .15s,color .15s}
.ch-btn:hover,.ch-btn.cur{background:var(--sur);color:var(--txt)}
.ch-btn.cur{font-weight:600}
#dback{flex:1;min-width:0;cursor:pointer}
#wt{height:100dvh;overflow-y:scroll;overscroll-behavior:contain}
#wt img{width:100%;max-width:800px;display:block;margin:0 auto}
.ch-div{max-width:800px;margin:0 auto;padding:20px 16px;text-align:center;font-size:12px;color:var(--muted);border-top:1px solid var(--bdr)}
#pf{height:100dvh;position:relative;overflow:hidden;background:var(--bg)}
#pf img{width:100%;height:100dvh;object-fit:contain;display:block;-webkit-user-select:none;user-select:none;pointer-events:none}
#pl,#pr{position:absolute;top:0;bottom:0;width:40%;z-index:10;cursor:pointer;-webkit-tap-highlight-color:transparent}
#pl{left:0}#pr{right:0}
</style>
</head>
<body>
<div id="bar">
  <button id="bar-menu" onclick="openD()" aria-label="Chapters">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  </button>
  <span id="bar-title"></span>
  <span id="bar-pg"></span>
</div>
<div id="strip"><div id="strip-f" style="width:0%"></div></div>
<div id="drawer">
  <div id="dpanel">
    <div id="dhead"><h2 id="dtitle"></h2><button id="dclose" onclick="closeD()">&#215;</button></div>
    <div id="ditems"></div>
  </div>
  <div id="dback" onclick="closeD()"></div>
</div>
<script>
const TITLE=PLACEHOLDER_TITLE_JSON;
const CHS=PLACEHOLDER_CHAPTERS_JSON;
const WEBTOON=PLACEHOLDER_WEBTOON;

document.title=TITLE;
document.getElementById('dtitle').textContent=TITLE;

let curCh=0,barOn=true,barTm=null;
const barEl=document.getElementById('bar');
const barTitle=document.getElementById('bar-title');
const barPg=document.getElementById('bar-pg');
const sf=document.getElementById('strip-f');
const ditems=document.getElementById('ditems');

let jumpTo=null; // assigned per-mode

CHS.forEach((ch,i)=>{
  const b=document.createElement('button');
  b.className='ch-btn'+(i===0?' cur':'');
  b.textContent=ch.t;
  b.dataset.i=i;
  b.onclick=()=>{ jumpTo&&jumpTo(i); closeD(); };
  ditems.appendChild(b);
});

function setBar(t,pg){ barTitle.textContent=t; barPg.textContent=pg||''; }
function setPct(p){ sf.style.width=Math.min(100,p)+'%'; }
function showBar(){ barOn=true; barEl.classList.remove('hide'); }
function hideBar(){ barOn=false; barEl.classList.add('hide'); }
function toggleBar(){ barOn?hideBar():showBar(); }
function autoHide(d){ clearTimeout(barTm); showBar(); if(d) barTm=setTimeout(hideBar,d); }
function openD(){ document.getElementById('drawer').classList.add('open'); showBar(); clearTimeout(barTm); }
function closeD(){ document.getElementById('drawer').classList.remove('open'); }
function setCur(i){
  curCh=i;
  document.querySelectorAll('.ch-btn').forEach(b=>b.classList.toggle('cur',+b.dataset.i===i));
}

if(WEBTOON){
  const wt=document.createElement('div'); wt.id='wt'; document.body.appendChild(wt);
  const chEls=[];
  CHS.forEach((ch,ci)=>{
    const wrap=document.createElement('div'); wrap.id='c'+ci;
    ch.p.forEach((src,pi)=>{
      const img=document.createElement('img');
      img.src=src; img.loading=pi<2?'eager':'lazy'; img.alt=''; img.decoding='async';
      wrap.appendChild(img);
    });
    if(ci<CHS.length-1){
      const d=document.createElement('div'); d.className='ch-div';
      d.textContent='── End of '+ch.t+' ──'; wrap.appendChild(d);
    }
    wt.appendChild(wrap); chEls.push(wrap);
  });

  jumpTo=(idx)=>{ chEls[idx]?.scrollIntoView({behavior:'instant'}); setCur(idx); setBar(CHS[idx].t,''); };
  setBar(CHS[0].t,'');

  let raf=null;
  wt.addEventListener('scroll',()=>{
    if(raf)return; raf=requestAnimationFrame(()=>{
      raf=null;
      const st=wt.scrollTop, sh=wt.scrollHeight-wt.clientHeight;
      setPct(sh>0?st/sh*100:0);
      for(let i=chEls.length-1;i>=0;i--){
        if(chEls[i].offsetTop<=st+wt.clientHeight*0.45){
          if(curCh!==i){ setCur(i); setBar(CHS[i].t,''); } break;
        }
      }
      autoHide(2500);
    });
  },{passive:true});

  let lastTap=0;
  wt.addEventListener('click',e=>{
    if(e.target.closest('#bar')||e.target.closest('#drawer'))return;
    const now=Date.now();
    if(now-lastTap<300){ toggleBar(); lastTap=0; } else lastTap=now;
  });
  autoHide(3000);

}else{
  const pf=document.createElement('div'); pf.id='pf';
  const img=document.createElement('img'); img.alt=''; img.draggable=false;
  const pl=document.createElement('div'); pl.id='pl';
  const pr=document.createElement('div'); pr.id='pr';
  pf.append(img,pl,pr); document.body.appendChild(pf);

  const flat=[];
  CHS.forEach((ch,ci)=>ch.p.forEach((src,pi)=>flat.push({src,ci,pi,tot:ch.p.length})));

  let fi=0;
  function show(idx){
    if(idx<0||idx>=flat.length)return;
    fi=idx; const p=flat[idx];
    img.src=p.src;
    if(curCh!==p.ci){ setCur(p.ci); }
    setBar(CHS[p.ci].t,(p.pi+1)+' / '+p.tot);
    setPct((idx+1)/flat.length*100);
    [-1,1].forEach(d=>{ if(flat[idx+d]){const pre=new Image();pre.src=flat[idx+d].src;} });
  }

  jumpTo=(idx)=>{ const s=flat.findIndex(p=>p.ci===idx); if(s>=0)show(s); };
  pr.onclick=()=>show(fi+1);
  pl.onclick=()=>show(fi-1);
  document.addEventListener('keydown',e=>{
    if(['ArrowRight','ArrowDown'].includes(e.key))show(fi+1);
    if(['ArrowLeft','ArrowUp'].includes(e.key))show(fi-1);
  });

  let lastTap=0;
  pf.addEventListener('click',e=>{
    if(e.target===pl||e.target===pr||e.target.closest('#bar')||e.target.closest('#drawer'))return;
    const now=Date.now();
    if(now-lastTap<300){ toggleBar(); lastTap=0; } else lastTap=now;
  });

  show(0); autoHide(3000);
}
</script>
</body>
</html>"""


# ── conversion worker ─────────────────────────────────────────────────────────

def _run_html(job_id: str, manga_id: str, chapter_ids: list[int]) -> None:
    _cleanup_old_jobs()
    try:
        total_chs = len(chapter_ids)

        # ── 1. Fetch chapter metadata ─────────────────────────────────────────
        _set_job(job_id, stage="Getting chapter info...", progress=2)
        info = _chapter_info_bulk(chapter_ids)
        if not info:
            _set_job(job_id, status="error", stage="Could not find any chapters", progress=0)
            return

        manga_title = next(iter(info.values()))["mangaTitle"]
        ordered = [info[cid] for cid in chapter_ids if cid in info]

        # ── 2. Download + compress every chapter ──────────────────────────────
        chapters_data = []     # [{t: title, p: [data_uri, ...]}, ...]
        is_webtoon = None

        for ch_i, (cid, meta) in enumerate(zip(chapter_ids, ordered)):
            base_pct = 5 + int(ch_i / total_chs * 80)
            _set_job(job_id,
                     stage=f"Fetching {meta['title']} ({ch_i+1}/{total_chs})...",
                     progress=base_pct)

            pages = _fetch_pages(cid)
            if not pages:
                _set_job(job_id, status="error",
                         stage=f"No pages for {meta['title']} — try again in a minute",
                         progress=0)
                return

            data_uris = []
            total_pages = len(pages)
            for p_i, path in enumerate(pages):
                if not path.startswith("/"):
                    continue
                r = requests.get(f"{SUWAYOMI}{path}", timeout=60)
                if not r.ok:
                    continue
                raw = r.content
                if is_webtoon is None:
                    is_webtoon = _is_webtoon_bytes(raw)
                max_w = _MAX_WIDTH_WT if is_webtoon else _MAX_WIDTH_MG
                compressed, mime = _compress_image(raw, max_w)
                data_uris.append(_to_data_uri(compressed, mime))

                pct = base_pct + int((p_i + 1) / total_pages * (80 // total_chs))
                _set_job(job_id,
                         stage=f"{meta['title']}: page {p_i+1}/{total_pages}",
                         progress=min(85, pct))

            chapters_data.append({"t": meta["title"], "p": data_uris})

        if is_webtoon is None:
            is_webtoon = False

        # ── 3. Render HTML ────────────────────────────────────────────────────
        _set_job(job_id, stage="Generating HTML file...", progress=90)

        html = _HTML.replace("PLACEHOLDER_TITLE", _safe_filename(manga_title))
        html = html.replace("PLACEHOLDER_TITLE_JSON", json.dumps(manga_title))
        html = html.replace("PLACEHOLDER_CHAPTERS_JSON", json.dumps(chapters_data))
        html = html.replace("PLACEHOLDER_WEBTOON", "true" if is_webtoon else "false")

        out_path = f"/tmp/mangaryu_{job_id}.html"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)

        # Filename
        nums = [info[cid]["chapterNum"] for cid in chapter_ids if cid in info]
        if len(nums) == 1:
            label = f"Ch.{nums[0]}"
        else:
            label = f"Ch.{nums[0]}-{nums[-1]}"
        filename = f"{_safe_filename(manga_title)} - {label}.html"

        _set_job(job_id, status="done", stage="Ready", progress=100,
                 file_path=out_path, filename=filename)

    except Exception as exc:
        log.exception("HTML job %s failed", job_id)
        _set_job(job_id, status="error", stage=str(exc)[:120], progress=0)


# ── routes ────────────────────────────────────────────────────────────────────

class HtmlRequest(BaseModel):
    chapter_ids: list[int]


@router.post("/api/manga/{manga_id}/download/html")
@limiter.limit("5/minute")
def start_html_download(request: Request, user: CurrentUser, manga_id: str, body: HtmlRequest):
    """Start an HTML reader export job. Returns {job_id} immediately."""
    if not body.chapter_ids:
        raise HTTPException(400, "chapter_ids must not be empty")
    if len(body.chapter_ids) > 20:
        raise HTTPException(400, "Maximum 20 chapters per bundle")

    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {
            "status":     "pending",
            "stage":      "Queued...",
            "progress":   0,
            "file_path":  None,
            "filename":   None,
            "created_at": time.time(),
        }

    threading.Thread(
        target=_run_html,
        args=(job_id, manga_id, body.chapter_ids),
        daemon=True,
    ).start()

    return {"job_id": job_id}
