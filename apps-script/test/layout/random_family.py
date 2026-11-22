# Synthetic family for the layout audit (made-up names only; never real relatives).
import json, random, itertools
import sys
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 7)
KIDS = [2,3,3,4,4,5] if (len(sys.argv) < 3 or sys.argv[2] != "small") else [1,2,2,3,3,4]
P=[["id","status","first_name","middle_name","birth_surname","married_names","nicknames","sex","living","birth_date","birth_place","death_date","death_place","notes","is_placeholder","merged_into","merge_log","source","submitted_by","submitted_at","batch_id","reviewed_at"]]
R=[["id","status","type","person_a","person_b","subtype","start_date","end_date","source","submitted_by","submitted_at","batch_id","reviewed_at"]]
c=itertools.count(); rc=itertools.count(); roles={}
def person(gen):
    i=f"P-{next(c):06d}"; roles[i]=f"g{gen}#{i[-4:]}"
    P.append([i,"approved","N"+i[-4:],"","Fam"+str(gen),"","","", "deceased" if gen<3 else "living","","","","","","","","","","C-1","t","B-1","t"]); return i
def link(t,a,b,s): R.append([f"R-{next(rc):06d}","approved",t,a,b,s,"","","","C-1","t","B-1","t"])
gen=[person(0) for _ in range(2)]; link("partner",gen[0],gen[1],"married"); couples=[(gen[0],gen[1])]
for g in range(1,6):
    nxt=[]
    for (a,b) in couples:
        for _ in range(random.choice(KIDS)):
            k=person(g); link("parent_child",a,k,"biological")
            if b: link("parent_child",b,k,"biological")
            if g<5 and random.random()<.9:
                s=person(g); link("partner",k,s,random.choice(["married","married","divorced","former"])); nxt.append((k,s))
                if random.random()<.15: s2=person(g); link("partner",k,s2,"married"); nxt.append((k,s2))
            elif g<5 and random.random()<.3: nxt.append((k,None))
    couples=nxt
    if len(roles)>300: break
json.dump({"People":P,"Relationships":R},open("/tmp/roots_random.json","w")); json.dump(roles,open("/tmp/roots_random_roles.json","w"))
# viewer: a gen-3 person with parents
kids=[r[4] for r in R[1:] if r[2]=="parent_child"]
v=[k for k in kids if roles[k].startswith("g3")][0]; open("/tmp/roots_random_viewer","w").write(v); print(len(roles),"people; viewer",v)
