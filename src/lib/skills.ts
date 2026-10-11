const SKILLS = ['python','java','javascript','typescript','react','node.js','sql','postgresql','mysql','mongodb','html','css','git','docker','aws','linux','rest api','data structures','algorithms','machine learning','spring boot','c++','tailwind','testing','system design','communication']
const has = (text: string, s: string) => new RegExp(`(^|[^a-z0-9+#])${s.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`, 'i').test(text)
export function analyzeSkills(own: string, jd: string) {
  const mine = SKILLS.filter(s => has(own, s)), wanted = SKILLS.filter(s => has(jd, s))
  const matched = wanted.filter(s => mine.includes(s)), missing = wanted.filter(s => !mine.includes(s))
  const tasks = missing.map(s => `Learn the basics of ${s} and build one small project using it`)
  return { mine, wanted, matched, missing, tasks }
}
