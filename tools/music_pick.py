import json,sys
name=sys.argv[1]
peaks=json.load(open(name+'.onsets.json'))
peaks=[(t-0.02,s) for t,s in peaks if t>0.3]
def pick(gap,seed=()):
    chosen=list(seed)
    for t,s in sorted(peaks,key=lambda p:-p[1]):
        if all(abs(t-c)>=gap for c in chosen): chosen.append(t)
    return sorted(chosen)
notes=pick(0.46)
dense=pick(0.27,notes)
json.dump({"notes":[round(x,3) for x in notes],"dense":[round(x,3) for x in dense]},open(name+'.beats.json','w'))
import statistics
g=[b-a for a,b in zip(notes,notes[1:])]
first=[round(x,2) for x in notes[:12]]
print(name,len(notes),len(dense),'median gap',round(statistics.median(g),2),'first',first, 'in first60:',sum(1 for x in notes if x<60),sum(1 for x in dense if x<60))
