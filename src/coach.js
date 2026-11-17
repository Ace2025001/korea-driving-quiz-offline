/* 只按公布答案判题；原创讲解只绑定经校验的题库题号。 */
const Coach=(()=>{
  const negative=/并不正确|不正确|不恰当|不适当|不可取|不属于|不符合|不安全|错误|不应当/;
  const basicClues=['不正确','不恰当','不适当','不属于','不符合','不安全','错误','最安全','最危险','正确的两项','正确的两个','两种','两项','暂时停车','一时停车','停止线','儿童保护区','没有信号灯','人行横道','右转专用','无保护左转','绿灯','红灯','闪烁','环形交叉口','血液酒精浓度','执行紧急任务','反方向','正在','准备'];
  function keyTerms(q,extra=[]){
    const matches=[...new Set([...extra,...basicClues])].filter(x=>q.prompt_zh.includes(x));
    return matches;
  }
  const verdict=(q,selected)=>{
    const answer=new Set(q.correct_answers), selection=new Set(selected);
    return q.options.map(o=>{
      const correct=answer.has(o.id), picked=selection.has(o.id);
      return {id:o.id,correct,picked,label:correct?(picked?'选对了':'漏选：这项该选'):(picked?'误选：这项不该选':'这项不选')};
    });
  };
  function signal(q){
    const stem=q.prompt_zh.split('\n')[0];
    const word=stem.match(negative)?.[0];
    if(word)return '本题带「'+word+'」。先判断每项，再选符合这个反向问法的选项。';
    if(/最安全|最恰当|最佳|最合适|最正确/.test(stem))return '本题要找最合适的做法。先排除违法或遗漏必要动作的选项，再比较剩下的。';
    if(/最危险|危险因素/.test(stem))return '本题在问危险，不是在问应采取的措施。看哪些人和车可能进入你的行驶路线。';
    if(q.question_type==='multiple')return '这是多选。每项独立判断；漏选或多选都算这道题没答对。';
    return '先读题目问谁、在什么场景、要你选什么，再对照选项。';
  }
  function chapterQuestions(pack,chapter){
    if(!pack?.manifest)return [];
    const byId=new Map(pack.bank.questions.map(q=>[q.question_id,q]));
    return chapter.order.map(id=>byId.get(id)).filter(q=>q&&pack.ready[q.question_id]);
  }
  function find(questions,query,max=24){
    const text=String(query).trim().replace(/^题号\s*/,'');
    if(!text)return [];
    if(/^\d+$/.test(text))return questions.filter(q=>q.question_id===String(Number(text))).slice(0,max);
    const words=text.slice(0,80).toLowerCase().split(/\s+/);
    return questions.filter(q=>{
      const where=[q.prompt_zh,...q.topics,...q.trap_tags].join(' ').toLowerCase();
      return words.every(w=>where.includes(w));
    }).slice(0,max);
  }
  return {keyTerms,verdict,signal,chapterQuestions,find};
})();
if(typeof module!=='undefined')module.exports=Coach;
