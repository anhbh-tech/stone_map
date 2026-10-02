// Số mã màu trong design: ≤ 13 pass, 14–15 warn, > 15 error (rules.max_codes_target / max_codes_hard).
import { counts } from '../design.js';

export default {
  id: 'code-count', level: 'error', title: 'Số mã màu',
  run(d, { cat }) {
    const { maxCodesTarget: T, maxCodesHard: H } = cat.rules, n = counts(d).codes;
    const level = n > H ? 'error' : n > T ? 'warn' : 'pass';
    return [{ level, msg: `${n} mã (mục tiêu ≤ ${T}, trần ${H})`, data: { codes: n, target: T, hard: H } }];
  },
};
