# Lone Oak / TempWorks AR closeout cross-match. Inputs (CSV exports, see docs/claude/project_lone_oak_ar_reconciliation.md)
# live in functions/.scratch/lone_oak/ (gitignored). Run: python3 scripts/lone-oak-ar-crossmatch.py functions/.scratch/lone_oak
import csv, re, json, datetime as dt
from collections import defaultdict, OrderedDict
import sys
S=sys.argv[1] if len(sys.argv)>1 else "functions/.scratch/lone_oak"
import os; os.chdir(S)
def money(s):
    s=(s or "").strip().replace("$","").replace(",","")
    if not s: return 0.0
    neg = s.startswith("(") and s.endswith(")")
    s=s.strip("()")
    try: v=float(s)
    except: return 0.0
    return -v if neg else v
def d(s):
    s=(s or "").strip()
    if not s: return None
    if not re.match(r"^\d{1,2}/\d{1,2}/\d{4}$",s): return None
    m,dd,y=s.split("/"); return dt.date(int(y),int(m),int(dd))

# ---- Lone Oak invoice registers (as of 5/10/2026)
lo={}
for fn,entity in [("lo_register_events_2026-05-10.csv","C1 Events"),("lo_register_select_2026-05-10.csv","C1 Select")]:
    rows=list(csv.reader(open(fn,encoding="utf-8-sig")))
    for r in rows[4:]:
        if len(r)<10 or not r[2].strip(): continue
        inv=r[2].strip()
        lo[inv]=dict(inv=inv,entity=entity,customer=r[3].strip(),cust_id=r[4].strip(),wk=d(r[5]),due=d(r[6]),amount=money(r[7]),paid=money(r[8]),balance=money(r[9]))
# January rows only in the PDF version of the Events register (1/1–1/30) — all fully paid
jan=[("60500600","AEG Management Oakland","1/18/2026",34077.10),("60500604","AEG Management Oakland","1/25/2026",484.50),
("60500594","G6 Catering","1/4/2026",596.25),("60500595","RS3 Hospitality","1/4/2026",1947.15),("60500596","RS3 Hospitality","1/4/2026",825.05),
("60500597","RS3 Hospitality","1/4/2026",119.00),("60500598","RS3 Hospitality","1/11/2026",1741.39),("60500599","RS3 Hospitality","1/11/2026",938.70),
("60500601","RS3 Hospitality","1/18/2026",2412.68),("60500602","RS3 Hospitality","1/18/2026",238.00),("60500605","RS3 Hospitality","1/25/2026",1244.17),
("60500606","RS3 Hospitality","1/25/2026",1409.18),("60500607","RS3 Hospitality","1/25/2026",202.30),("60500603","VenueSmart LLC","1/18/2026",1198.40),
("60500608","VenueSmart LLC","1/25/2026",621.60),("60500609","VenueSmart LLC","1/25/2026",2320.00)]
for inv,c,wk,a in jan:
    if inv not in lo: lo[inv]=dict(inv=inv,entity="C1 Events",customer=c,cust_id="",wk=d(wk),due=None,amount=a,paid=a,balance=0.0)
print("LO register invoices:",len(lo), " billed=%.2f paid=%.2f bal=%.2f"%(sum(v['amount'] for v in lo.values()),sum(v['paid'] for v in lo.values()),sum(v['balance'] for v in lo.values())))

# ---- Lone Oak funding reports (financed flag, fee, pay date through 4/14)
fund={}
for fn in ["lo_funding_jan_mar.csv","lo_funding_apr1_14.csv"]:
    rows=list(csv.reader(open(fn,encoding="utf-8-sig")))
    for r in rows[3:]:
        if len(r)<13 or not r[2].strip(): continue
        fund[r[2].strip()]=dict(group=r[0],customer=re.sub(r"\s+\(\d+ invoices?\)","",r[1]).strip(),amount=money(r[3]),date=d(r[4]),pay=money(r[5]),paydate=d(r[6]),bal=money(r[7]),financed=money(r[8]),fee=money(r[9]),reserve=money(r[11]),dueclient=money(r[12]))
print("Funding-report invoices:",len(fund))

# ---- QBO A/R aging detail snapshots
def qbo(fn):
    out=OrderedDict()
    for r in csv.reader(open(fn,encoding="utf-8-sig")):
        if len(r)>=8 and r[0]=="" and r[2]=="Invoice":
            if len(r)==9: date,num,cust,div,due,amt,openb=r[1],r[3],r[4],r[5],r[6],r[7],r[8]
            else: date,num,cust,div,due,amt,openb=r[1],r[3],r[4],"",r[5],r[6],r[7]
            out[num.strip()]=dict(num=num.strip(),date=d(date),customer=cust,division=div,due=d(due),amount=money(amt),open=money(openb))
    return out
q0625=qbo("qbo_ar_aging_2026-06-25.csv"); q0430=qbo("qbo_ar_aging_2026-04-30.csv")
print("QBO open Jun25:",len(q0625),"total open=%.2f"%sum(v['open'] for v in q0625.values()))
print("QBO open Apr30:",len(q0430),"total open=%.2f"%sum(v['open'] for v in q0430.values()))

CUT=dt.date(2026,5,13)
# map QBO doc numbers to LO numbers (typo family 606007xx -> 605007xx; "(Mark Draft)")
def lo_key(num):
    n=num.split(" ")[0]
    if n in lo: return n
    alt=n.replace("60600","60500",1)
    if alt in lo: return alt
    return None

pre=[v for v in q0625.values() if v['date'] and v['date']<=CUT]
print("\nQBO open on 6/25 with invoice date <= 5/13:",len(pre)," open=%.2f"%sum(v['open'] for v in pre))
cats=defaultdict(list)
for v in pre:
    k=lo_key(v['num']); v['lo']=k
    if not k: cats['NOT_IN_LONE_OAK_REGISTER'].append(v); continue
    L=lo[k]
    if L['balance']<=0.005 and L['paid']>0: cats['PAID_TO_LONE_OAK_BY_5-10'].append(v)
    elif L['paid']>0: cats['PARTIAL_AT_LONE_OAK_5-10'].append(v)
    else: cats['OPEN_AT_LONE_OAK_5-10'].append(v)
for c,lst in cats.items():
    print("\n### %s  (%d invoices, QBO open $%.2f)"%(c,len(lst),sum(x['open'] for x in lst)))
    for v in sorted(lst,key=lambda x:(x['customer'],x['date'])):
        L=lo.get(v['lo']) ; F=fund.get(v['lo'] or "")
        extra=""
        if L: extra=" | LO: amt %.2f paid %.2f bal %.2f%s"%(L['amount'],L['paid'],L['balance'], "" if L['amount']==v['amount'] else " **AMT DIFF**")
        if F: extra+=" | %s%s"%("FINANCED" if F['financed']>0 else "non-financed", (" paid "+str(F['paydate'])) if F['paydate'] else "")
        print("  %-22s %-9s %s qbo %9.2f open %9.2f%s"%(v['num'],v['customer'][:22],v['date'],v['amount'],v['open'],extra))

# LO register invoices with balance at 5/10 that are NOT open in QBO 6/25 (closed in QBO somehow)
print("\n### LONE OAK OPEN AT 5/10 BUT NOT OPEN IN QBO 6/25 (verify how they were closed / whether they exist in QBO)")
qnums=set(); 
for n in q0625: 
    k=lo_key(n); 
    if k: qnums.add(k)
tot=0
for k,L in sorted(lo.items(),key=lambda kv:(kv[1]['customer'],kv[0])):
    if L['balance']>0.005 and k not in qnums:
        tot+=L['balance']; print("  %-12s %-24s %s amt %9.2f LO bal %9.2f"%(k,L['customer'][:24],L['wk'],L['amount'],L['balance']))
print("  total LO balance:",round(tot,2))

# summary by customer for QBO-open pre-cutoff
print("\n### SUMMARY BY CUSTOMER (QBO open 6/25, invoice date <= 5/13)")
byc=defaultdict(lambda: defaultdict(float))
for c,lst in cats.items():
    for v in lst: byc[v['customer'].split(":")[0]][c]+=v['open']; byc[v['customer'].split(":")[0]]['TOTAL']+=v['open']
for c,dd in sorted(byc.items(),key=lambda kv:-kv[1]['TOTAL']):
    print("  %-26s"%c, {k:round(x,2) for k,x in dd.items()})
json.dump(dict(cats={c:[{k:(str(x) if isinstance(x,dt.date) else x) for k,x in v.items()} for v in l] for c,l in cats.items()}),open("crossmatch.json","w"),indent=1,default=str)

# ---- worklist CSV
NATIVE=set(["60600076","60600077","60600078","60600079","60600080","60600081","60600082"])  # QBO-native 5/12 invoices (post-cutoff)
rows=[]
for c,lst in cats.items():
    for v in lst:
        if v['num'] in NATIVE: continue
        L=lo.get(v['lo']) if v['lo'] else None; F=fund.get(v['lo'] or "")
        if c=='PAID_TO_LONE_OAK_BY_5-10':
            action="CLOSE NOW: receive payment dated per Lone Oak pay date, deposit to 'Due from Lone Oak (factor clearing)'"
        elif c=='PARTIAL_AT_LONE_OAK_5-10':
            action="Apply $%.2f to factor clearing; confirm remaining $%.2f on 9/4 report (Proof remit shows $7,300.87 paid to lockbox in June)"%(L['paid'],L['balance'])
        elif c=='OPEN_AT_LONE_OAK_5-10':
            action="CONFIRM on 9/4 funding report: PayDate/PayAmount -> if paid to Lone Oak, close via factor clearing; if unpaid, keep open and collect direct"
        else:
            action="Pre-2026 invoice, outside Lone Oak 1/1 report: check AEG check-payment report / Lone Oak 11-2025 statement" if v['date'].year==2025 else "?"
        rows.append(dict(customer=v['customer'],qbo_num=v['num'],lone_oak_num=v['lo'] or "",inv_date=v['date'],qbo_amount=v['amount'],qbo_open_6_25=v['open'],
            lo_paid_5_10=L['paid'] if L else "",lo_balance_5_10=L['balance'] if L else "",financed=("Y" if F and F['financed']>0 else ("N" if F else "")),
            lo_pay_date_thru_4_14=F['paydate'] if F else "",category=c,recommended_action=action))
rows.sort(key=lambda r:(r['customer'],str(r['inv_date'])))
with open("qbo_pre-cutoff_open_worklist.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print("\nworklist rows:",len(rows)," open total=%.2f"%sum(r['qbo_open_6_25'] for r in rows))
# LO open at 5/10 but not in QBO aging -> second CSV for verification
rows2=[]
for k,L in sorted(lo.items(),key=lambda kv:(kv[1]['customer'],kv[0])):
    if L['balance']>0.005 and k not in qnums:
        rows2.append(dict(customer=L['customer'],invoice=k,weekend_bill=L['wk'],amount=L['amount'],lo_balance_5_10=L['balance'],financed=("Y" if fund.get(k) and fund[k]['financed']>0 else ("N" if fund.get(k) else ""))))
with open("lone_oak_open_5-10_not_in_qbo_aging.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(rows2[0].keys())); w.writeheader(); w.writerows(rows2)
print("verify rows:",len(rows2))
