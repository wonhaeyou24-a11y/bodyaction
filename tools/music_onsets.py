import array,sys,math,json
name=sys.argv[1]
a=array.array('h');a.frombytes(open(name+'.full.raw','rb').read())
sr=8000;hop=40;fps=sr/hop  # 5ms
# 간단한 대역 분리 없이 에너지 + 스펙트럴 플럭스 근사: 짧은 창 RMS의 로그 차분
def rms(i,w): 
    s=0
    for x in a[i:i+w]: s+=x*x
    return math.sqrt(s/w)
w=160 # 20ms
env=[math.log(1+rms(i,w)) for i in range(0,len(a)-w,hop)]
n=len(env)
# 고주파 성분 강조: 1차 차분(원신호)의 RMS도 사용
d=array.array('h',[0])+array.array('h',[max(-32768,min(32767,a[i]-a[i-1])) for i in range(1,len(a))])
envh=[math.log(1+rms2) for rms2 in [math.sqrt(sum(x*x for x in d[i:i+w])/w) for i in range(0,len(d)-w,hop)]]
def flux(e,lag=8):
    return [max(0,e[i]-min(e[max(0,i-lag):i+1])) if i>0 else 0 for i in range(len(e))]
f1=flux(env);f2=flux(envh)
on=[f1[i]+f2[i] for i in range(n)]
# 지역 평균 대비 피크 선택
peaks=[];W=int(0.5*fps)
for i in range(2,n-2):
    if on[i]>=on[i-1] and on[i]>on[i+1] and on[i]>on[i-2] and on[i]>=on[i+2]:
        lo=max(0,i-W);hi=min(n,i+W);m=sum(on[lo:hi])/(hi-lo)
        if on[i]>m*1.4: peaks.append((i/fps,on[i]/ (m+1e-9)))
print(name,'dur',round(n/fps,1),'raw onsets',len(peaks))
json.dump(peaks,open(name+'.onsets.json','w'))
