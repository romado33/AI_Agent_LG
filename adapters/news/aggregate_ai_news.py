#!/usr/bin/env python3
"""
AI Daily News — headlines-only email

- Filters to *today* (America/Toronto).
- Five sources: The Neuron, The Download, TLDR AI, Superhuman, The Rundown AI.
- Cleans boilerplate.
- Emails ONLY per-source lists of [Headline](link). Link = first URL in the
  topic. For TLDR AI, resolves [n] references from the "Links:" block.

Outputs:
- Writes ai_digest_YYYY-MM-DD.{md,html} locally for archive.
- Email body is headlines + links only. No attachments.

Reqs:
pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib beautifulsoup4 html2text markdown
"""

import base64, os, re, sys, html
import datetime as dt
from zoneinfo import ZoneInfo
from typing import List, Dict, Any, Tuple, Optional
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from bs4 import BeautifulSoup
import html2text
import markdown

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# -------------------- Config --------------------
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]

CANONICAL_SOURCES = ["The Neuron","The Download","TLDR AI","Superhuman","The Rundown AI"]
SOURCE_RULES = [
    (r"theneurondaily\.com|subject:.*\bNeuron\b", "The Neuron"),
    (r"technologyreview\.com|subject:.*\bThe Download\b", "The Download"),
    (r"tldrnewsletter\.com|subject:.*\bTLDR AI\b", "TLDR AI"),
    (r"superhuman\.ai|subject:.*\bSuperhuman\b", "Superhuman"),
    (r"therundown\.ai|subject:.*\bRundown\b", "The Rundown AI"),
]

OUT_DIR = "ai_digest_output"
TZ = ZoneInfo("America/Toronto")

# -------------------- Gmail auth --------------------
def gmail_service():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists("credentials.json"):
                sys.exit("Missing credentials.json")
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        with open("token.json", "w", encoding="utf-8") as token:
            token.write(creds.to_json())
    return build("gmail","v1",credentials=creds)

# -------------------- Search today --------------------
def gmail_search_query_today() -> str:
    now = dt.datetime.now(TZ)
    start = dt.date(now.year, now.month, now.day)
    end = start + dt.timedelta(days=1)
    s, e = start.strftime("%Y/%m/%d"), end.strftime("%Y/%m/%d")
    terms = [
        'subject:"The Neuron" OR from:theneurondaily.com',
        'subject:"The Download" OR from:technologyreview.com',
        'subject:"TLDR AI" OR from:tldrnewsletter.com',
        'subject:"Superhuman" OR from:superhuman.ai',
        'subject:"The Rundown" OR from:therundown.ai OR subject:"Rundown AI"',
    ]
    return f'after:{s} before:{e} ((' + ') OR ('.join(terms) + '))'

def list_message_ids(svc) -> List[str]:
    q = gmail_search_query_today()
    res = svc.users().messages().list(userId="me", q=q, maxResults=200).execute()
    ids = [m["id"] for m in res.get("messages",[])]
    tok = res.get("nextPageToken")
    while tok:
        res = svc.users().messages().list(userId="me", q=q, pageToken=tok, maxResults=200).execute()
        ids += [m["id"] for m in res.get("messages",[])]
        tok = res.get("nextPageToken")
    return ids

def fetch_message(svc, mid: str) -> Dict[str,Any]:
    return svc.users().messages().get(userId="me", id=mid, format="full").execute()

def decode_part(data_b64: str) -> str:
    return base64.urlsafe_b64decode(data_b64.encode("utf-8")).decode("utf-8","ignore")

def extract_bodies(payload: Dict[str,Any]) -> Tuple[str,str]:
    plain, html_txt = "", ""
    def walk(p):
        nonlocal plain, html_txt
        mt = p.get("mimeType","")
        b = p.get("body",{}).get("data")
        if "parts" in p:
            for c in p["parts"]: walk(c)
        elif b:
            t = decode_part(b)
            if mt=="text/plain": plain += t+"\n"
            elif mt=="text/html": html_txt += t+"\n"
    walk(payload)
    return plain.strip(), html_txt.strip()

# -------------------- Cleaning --------------------
FOOTER_LINE_PAT = re.compile(r"(?is)\b(unsubscribe|privacy policy|terms of service|manage (?:your )?preferences|view in browser|manage subscriptions)\b")
SPONSOR_HDR_PAT = re.compile(r"(?is)^(together with|sponsored)\b")

def strip_boilerplate_html(raw: str) -> str:
    if not raw: return ""
    s = BeautifulSoup(raw,"html.parser")
    for t in s(["script","style","noscript"]): t.decompose()
    for t in s.find_all("footer"): t.decompose()
    for t in s.select('[role="contentinfo"]'): t.decompose()
    KEY=("unsubscribe","manage preferences","manage subscription","view in browser")
    for a in s.find_all("a"):
        txt=(a.get_text(" ",strip=True) or "").lower()
        href=(a.get("href") or "").lower()
        if any(k in txt or k in href for k in KEY):
            (a.find_parent(["p","li","div","td","tr","section"],True) or a).decompose()
    return str(s)

def html_to_md(raw: str) -> str:
    if not raw: return ""
    h=html2text.HTML2Text(); h.ignore_links=False; h.ignore_images=True; h.body_width=0; h.single_line_break=True
    md=h.handle(raw)
    md=re.sub(r"\n{3,}","\n\n",md)
    return md.strip()

def clean_md(md: str) -> str:
    out=[]; skipping=False
    for raw in (md or "").splitlines():
        line=raw.rstrip(); l=line.strip().lower()
        if SPONSOR_HDR_PAT.match(l) or "(sponsor" in l or "sponsor)" in l:
            skipping=True; continue
        if skipping and (not l or l.startswith("#") or re.match(r"^[A-Z].+?:$", line.strip())):
            skipping=False
            if not l: continue
        if skipping: continue
        if (FOOTER_LINE_PAT.search(l) or re.search(r"(facebook|twitter|linkedin|instagram)\.com", l)) and len(line)<=140:
            continue
        out.append(line)
    text="\n".join(out)
    text=re.sub(r"\n{3,}","\n\n",text)
    text=re.sub(r"[ \t]+$","",text,flags=re.M)
    text=re.sub(r"https?://\S{80,}","",text)
    return text.strip()

def compact(md: str) -> str:
    lines=md.splitlines()
    out=[]; blank=False
    for l in lines:
        l=re.sub(r"[ \t]+$","",l.rstrip())
        if l.strip()=="":
            if not blank: out.append(""); blank=True
            continue
        l=re.sub(r"^(\s*[-*+])\s+", r"\1 ", l)
        l=re.sub(r"\s{2,}", " ", l)
        out.append(l.strip()); blank=False
    return "\n".join(out).strip()

# -------------------- Topics and helpers --------------------
HEADLINE_BOLD = re.compile(r"^\s*[\-\*]?\s*\*\*(?P<h>[^*]{6,})\*\*\s*$")
HEADLINE_MINREAD = re.compile(r"^([A-Z].+?)\s*\(\d+\s*minute read\)\s*$", re.I)
SECTION_H2 = re.compile(r"^##\s+(?P<h>.+?)\s*$", re.I)
URL_RE = re.compile(r"https?://[^\s\)\]]+")

def extract_headlines(md: str) -> List[str]:
    heads=[]; seen=set()
    for ln in (md or "").splitlines():
        m = HEADLINE_BOLD.match(ln) or HEADLINE_MINREAD.match(ln) or SECTION_H2.match(ln)
        if m:
            h=(m.groupdict().get("h") or m.group(1)).strip()
            if len(h)>=6 and h not in seen:
                heads.append(h); seen.add(h)
    return heads

def split_topics(md: str) -> List[Tuple[str,str]]:
    lines=md.splitlines()
    marks=[]
    for i,ln in enumerate(lines):
        m = HEADLINE_BOLD.match(ln) or HEADLINE_MINREAD.match(ln) or SECTION_H2.match(ln)
        if m:
            t=(m.groupdict().get("h") or m.group(1)).strip()
            if len(t)>=6: marks.append((i,t))
    if not marks: return []
    out=[]
    for n,(i,t) in enumerate(marks):
        j=marks[n+1][0] if n+1<len(marks) else len(lines)
        body="\n".join(lines[i+1:j]).strip()
        if body: out.append((t,body))
    return out

def first_url(md_segment: str) -> Optional[str]:
    m = URL_RE.search(md_segment or "")
    return m.group(0) if m else None

def md_to_html(md: str) -> str:
    return markdown.markdown(md, extensions=["extra","sane_lists"])

# -------------------- TLDR-specific extraction --------------------
TLDR_TITLE_LINE = re.compile(r"^([A-Z0-9'&\-\.,: ]+?)\s*\(\d+\s*MINUTE READ\)\s*\[(\d+)\]\s*$", re.I)
TLDR_LINK_LINE = re.compile(r"^\[(\d+)\]\s+(https?://\S+)\s*$")

def parse_reference_links(md: str) -> Dict[str, str]:
    """
    Builds {'5': 'https://...'} from the 'Links:' section lines.
    """
    links: Dict[str, str] = {}
    in_links = False
    for line in md.splitlines():
        if line.strip().lower().startswith("links:"):
            in_links = True
            continue
        if in_links:
            m = TLDR_LINK_LINE.match(line.strip())
            if m:
                links[m.group(1)] = m.group(2)
    return links

def extract_tldr_items(md: str) -> List[Tuple[str, str]]:
    """
    Return [(title, url)] using TLDR's 'TITLE (N MINUTE READ) [id]' lines
    and the 'Links:' mapping for URLs.
    """
    ref = parse_reference_links(md)
    items: List[Tuple[str, str]] = []
    for line in md.splitlines():
        m = TLDR_TITLE_LINE.match(line.strip())
        if not m:
            continue
        title = m.group(1).strip().rstrip(".")
        ref_id = m.group(2)
        url = ref.get(ref_id)
        if url:
            items.append((title, url))
    # dedupe while preserving order
    seen = set()
    out = []
    for t,u in items:
        key = (t,u)
        if key in seen: 
            continue
        seen.add(key)
        out.append((t,u))
    return out

# -------------------- Build: archive + email body --------------------
def build_md_archive(per_source: Dict[str,Dict[str,Any]]) -> str:
    today=dt.datetime.now(TZ).strftime("%Y-%m-%d")
    out=[f"# AI Daily Digest — {today}",""]
    for canon in CANONICAL_SOURCES:
        it=per_source.get(canon)
        out.append(f"## {canon}")
        if not it:
            out.append("*No email found for today.*"); continue
        topics=split_topics(it["content_md"])
        if not topics:
            # TLDR fallback for archive: list TLDR titles
            if canon=="TLDR AI":
                items = extract_tldr_items(it["content_md"])
                if items:
                    for t,_ in items: out.append(f"- {t}")
                    out.append(""); continue
            out.append(compact(it["content_md"])); out.append(""); continue
        for t,_ in topics:
            out.append(f"- {t}")
        out.append("")
    return compact("\n".join(out))

def build_html_email_headlines(per_source: Dict[str,Dict[str,Any]]) -> str:
    today=dt.datetime.now(TZ).strftime("%Y-%m-%d")
    style = """
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      h1,h2{margin:0.4em 0}
      .src{margin:16px 0 8px 0}
      ul{margin:6px 0 10px 18px}
      a{color:#0b57d0;text-decoration:none}
      a:hover{text-decoration:underline}
    </style>
    """
    parts=[style, "<h1>AI Daily Digest — "+html.escape(today)+"</h1>"]
    for canon in CANONICAL_SOURCES:
        it=per_source.get(canon)
        parts.append(f"<h2 class='src'>{html.escape(canon)}</h2>")
        if not it:
            parts.append("<p><em>No email found for today.</em></p>"); continue

        topics=split_topics(it["content_md"])

        # If TLDR had no topics, use TLDR-specific extractor
        if canon=="TLDR AI" and not topics:
            items = extract_tldr_items(it["content_md"])
            if items:
                parts.append("<ul>")
                for t,u in items:
                    parts.append(f"<li><a href='{html.escape(u)}' target='_blank'>{html.escape(t)}</a></li>")
                parts.append("</ul>")
                continue

        if not topics:
            heads=extract_headlines(it["content_md"])
            if heads:
                parts.append("<ul>"+ "".join("<li>"+html.escape(h)+"</li>" for h in heads) + "</ul>")
            else:
                parts.append("<p><em>No structured topics detected.</em></p>")
            continue

        parts.append("<ul>")
        gmail_link = it.get("gmail_link")
        for t,b in topics:
            url = first_url(b) or gmail_link or "#"
            parts.append(f"<li><a href='{html.escape(url)}' target='_blank'>{html.escape(t)}</a></li>")
        parts.append("</ul>")
    return "\n".join(parts)

# -------------------- Email send --------------------
def send_email(svc, sender: str, to_addr: str, subject: str, html_body: str):
    msg = MIMEMultipart("alternative")
    msg["To"]=to_addr; msg["From"]=sender; msg["Subject"]=subject
    msg.attach(MIMEText("Headlines only. Open links to read each item.", "plain","utf-8"))
    msg.attach(MIMEText(html_body, "html","utf-8"))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
    svc.users().messages().send(userId="me", body={"raw": raw}).execute()

# -------------------- Main --------------------
def first_header(headers: List[Dict[str,str]], name: str) -> str:
    n=name.lower()
    for h in headers:
        if h.get("name","").lower()==n:
            return h.get("value","")
    return ""

def canonicalize_source(frm: str, sub: str) -> str:
    hay=f"{frm} || {sub}".lower()
    for pat,canon in SOURCE_RULES:
        if re.search(pat, hay): return canon
    for c in CANONICAL_SOURCES:
        if c.lower() in hay: return c
    return "Unknown"

def main():
    svc=gmail_service(); os.makedirs(OUT_DIR, exist_ok=True)
    ids=list_message_ids(svc)
    if not ids: print("No matching emails found for today."); return

    per={}
    for mid in ids:
        m=fetch_message(svc, mid)
        payload=m.get("payload",{})
        headers=payload.get("headers",[])
        subject=first_header(headers,"Subject") or "(no subject)"
        frm=first_header(headers,"From") or "(unknown)"
        canon=canonicalize_source(frm,subject)
        if canon not in CANONICAL_SOURCES: continue
        epoch=int(m.get("internalDate","0"))//1000 if m.get("internalDate") else 0

        plain, html_raw = extract_bodies(payload)
        html_md = html_to_md(strip_boilerplate_html(html_raw)) if html_raw else ""
        plain_md = (plain or "").strip()

        a=clean_md(html_md); b=clean_md(plain_md)
        md_text = a if len(a)>=len(b) else b
        if len(md_text)<500:
            md_text = html_md if len(html_md)>=len(plain_md) else plain_md
        if not md_text: continue

        item={
            "source":canon,
            "subject":subject,
            "content_md":md_text,
            "gmail_link": f"https://mail.google.com/mail/u/0/#inbox/{m['id']}",
            "epoch":epoch
        }
        if (canon not in per) or (epoch>per[canon]["epoch"]): per[canon]=item

    # Write archives
    today=dt.datetime.now(TZ).strftime("%Y-%m-%d")
    md_archive = build_md_archive(per)
    html_archive = markdown.markdown(md_archive, extensions=["extra","sane_lists"])
    with open(os.path.join(OUT_DIR, f"ai_digest_{today}.md"), "w", encoding="utf-8") as f: f.write(md_archive)
    with open(os.path.join(OUT_DIR, f"ai_digest_{today}.html"), "w", encoding="utf-8") as f: f.write(html_archive)
    print(f"Written: {os.path.join(OUT_DIR, f'ai_digest_{today}.md')}\nWritten: {os.path.join(OUT_DIR, f'ai_digest_{today}.html')}")

    # Email headlines-only
    html_body = build_html_email_headlines(per)
    me = svc.users().getProfile(userId="me").execute()
    sender = os.getenv("DIGEST_FROM", me.get("emailAddress"))
    to_addr = os.getenv("DIGEST_TO", me.get("emailAddress"))
    subject = f"AI Daily Digest — {today}"
    send_email(svc, sender, to_addr, subject, html_body)
    print(f"Sent email to {to_addr}")

if __name__=="__main__":
    main()
