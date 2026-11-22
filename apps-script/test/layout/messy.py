# Synthetic family for the layout audit (made-up names only; never real relatives).
# A deliberately messy synthetic family, centered on V. Every relationship shape we can think of.
import json, itertools
P=[["id","status","first_name","middle_name","birth_surname","married_names","nicknames","sex","living","birth_date","birth_place","death_date","death_place","notes","is_placeholder","merged_into","merge_log","source","submitted_by","submitted_at","batch_id","reviewed_at"]]
R=[["id","status","type","person_a","person_b","subtype","start_date","end_date","source","submitted_by","submitted_at","batch_id","reviewed_at"]]
role={}
def p(key, first, last, living="living", ph=""):
    role[key]=first+' '+last
    P.append([key,"approved",first,"",last,"","","",living,"","","","","",ph,"","","","C-1","2026-01-01T00:00:00.000Z","B-1","2026-01-01T00:00:00.000Z"])
n=itertools.count()
def pc(a,b,sub="biological"): R.append([f"R-{next(n):08x}","approved","parent_child",a,b,sub,"","","","C-1","t","B-1","t"])
def pt(a,b,sub="married"): R.append([f"R-{next(n):08x}","approved","partner",a,b,sub,"","","","C-1","t","B-1","t"])
def kids(par, ks):
    for k in ks:
        for x in par: pc(x,k)
# ancestors 5 deep on dad's side
p("V","Vic","Viewer"); p("A","Al","Viewer","deceased"); p("B","Bea","Viewer","deceased"); pt("A","B"); kids(["A","B"],["V"])
p("GA1","Gus","Viewer","deceased"); p("GA2","Gwen","Viewer","deceased"); pt("GA1","GA2"); kids(["GA1","GA2"],["A"])
p("GGA1","Greta","Old","deceased"); p("GGA2","Otto","Old","deceased"); pt("GGA1","GGA2"); kids(["GGA1","GGA2"],["GA1"])
p("GGGA1","Ida","Older","deceased"); kids(["GGGA1"],["GGA1"])
p("GGGGA1","Ezra","Oldest","deceased"); kids(["GGGGA1"],["GGGA1"])
p("GB1","Hal","Mom","deceased"); p("GB2","Hazel","Mom","deceased"); pt("GB1","GB2","divorced"); kids(["GB1","GB2"],["B"])
p("GB3","Hank","Step","deceased"); pt("GB2","GB3"); p("MHalf","Molly","Step"); kids(["GB2","GB3"],["MHalf"])   # mom's half-sister
p("MHalfK","Mack","Step"); kids(["MHalf"],["MHalfK"])                                                     # half-cousin via grandma's 2nd marriage
# dad's former partner and half-sibling, who has their own half-sibling (no relation to V)
p("C","Cora","Ex"); pt("A","C","divorced"); p("H1","Hugo","Viewer"); kids(["A","C"],["H1"])
p("D","Dan","Other"); pt("C","D"); p("H1h","Hana","Other"); kids(["C","D"],["H1h"])
p("H1w","Hope","Wife"); pt("H1","H1w"); p("H1k","Huey","Viewer"); kids(["H1","H1w"],["H1k"])         # half-nephew
# mom's sister with two marriages; cousins, cousin's spouse and kids, half-cousin
p("Au1","Ann","Mom","deceased"); kids(["GB1","GB2"],["Au1"])
p("U1","Ugo","First"); pt("Au1","U1","divorced"); p("Cz3","Cal","First"); kids(["Au1","U1"],["Cz3"])
p("U2","Uri","Second"); pt("Au1","U2"); p("Cz1","Cleo","Second"); p("Cz2","Cy","Second"); kids(["Au1","U2"],["Cz1","Cz2"])
p("Cz1s","Sam","Spouse"); pt("Cz1","Cz1s"); p("Cz1k1","Kit","Spouse"); p("Cz1k2","Kai","Spouse"); kids(["Cz1","Cz1s"],["Cz1k1","Cz1k2"])
p("Cz1kk","Kip","Spouse"); kids(["Cz1k1"],["Cz1kk"])
# dad's brother, unmarried, kid with partner
p("Un2","Ned","Viewer"); kids(["GA1","GA2"],["Un2"]); p("Un2p","Pia","Partner"); pt("Un2","Un2p","partner"); p("Cz4","Cass","Viewer"); kids(["Un2","Un2p"],["Cz4"])
# great-uncle line (grandpa's brother) with kids and grandkids; one grandkid marries cousin Cz2
p("GU","Gil","Viewer","deceased"); kids(["GGA1","GGA2"],["GU"]); p("GUw","Gina","Viewer","deceased"); pt("GU","GUw")
p("C1r","Rae","Viewer"); kids(["GU","GUw"],["C1r"]); p("C2","Rex","Viewer"); kids(["C1r"],["C2"]); pt("Cz2","C2")
# V's sibling with family; nephew has kids; adopted niece
p("S1","Sid","Viewer"); kids(["A","B"],["S1"]); p("S1w","Sue","Wed"); pt("S1","S1w")
p("N1","Nan","Viewer"); p("N2","Nia","Viewer"); kids(["S1","S1w"],["N1"]); pc("S1","N2","adopted"); pc("S1w","N2","adopted")
p("N1k","Ned","Junior"); kids(["N1"],["N1k"])
# V's partners and kids; grandkids; great-grandkids (beyond 2 down); kid's spouse's family
p("P1","Pat","Partner"); pt("V","P1"); p("P2","Peg","Former"); pt("V","P2","former")
p("K1","Kim","Viewer"); kids(["V","P1"],["K1"]); p("K2","Ken","Viewer"); kids(["V","P2"],["K2"])
p("K1s","Lou","InLaw"); pt("K1","K1s"); p("GK1","Gia","InLaw"); kids(["K1","K1s"],["GK1"]); p("GGK1","Gem","InLaw"); kids(["GK1"],["GGK1"])
p("K1sp1","Lars","InLaw","deceased"); kids(["K1sp1"],["K1s"]); p("K1sb","Lena","InLaw"); kids(["K1sp1"],["K1sb"])
# V's son with two current partners and children by each: each set must hang from its own couple
p("K3","Kurt","Viewer"); kids(["V","P1"],["K3"]); p("K3a","Ava","First"); p("K3b","Bree","Second"); pt("K3","K3a"); pt("K3","K3b","partner")
p("K3a1","Abe","Viewer"); p("K3a2","Amy","Viewer"); kids(["K3","K3a"],["K3a1","K3a2"]); p("K3b1","Ben","Viewer"); kids(["K3","K3b"],["K3b1"])
# P1's family (in-laws): parents, sibling, sibling's kids
p("P1f","Paco","Partner","deceased"); p("P1m","Pam","Partner"); pt("P1f","P1m"); kids(["P1f","P1m"],["P1"])
p("P1sib","Pip","Partner"); kids(["P1f","P1m"],["P1sib"]); p("P1sk","Poe","Partner"); kids(["P1sib"],["P1sk"])
# P2 has a child from another relationship (V's stepchild?) not V's
p("P2o","Ola","Other"); pt("P2","P2o"); p("P2k","Pru","Other"); kids(["P2","P2o"],["P2k"])
# step-parent of V's kid: P1 remarried? no. K2 lives with P2 & P2o: P2o is K2's step-parent.
# a placeholder link: unknown grandparent between GGA1-line and someone
p("X","","","unknown","true"); p("GGU","Ulf","Old","deceased"); kids(["GGGA1"],["X"]); kids(["X"],["GGU"])  # great-grand-uncle via unknown
json.dump({"People":P,"Relationships":R},open("/tmp/roots_messy.json","w"))
json.dump(role,open("/tmp/roots_messy_roles.json","w"))
print(len(P)-1,"people",len(R)-1,"links")
