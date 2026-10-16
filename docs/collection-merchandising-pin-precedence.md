# Collection merchandising Pin precedence

The observed Prom sequence places explicit saved pins first, then Champagne
merchandising pins. Within the Champagne group, BestProm score 100 precedes
TopProm score 99. The previous layered comparator placed the complete BestProm
100 group ahead of Champagne products with score 99; Adora 3161 appeared at 77
instead of the source's position 16.

The compatibility adjustment recognizes the observed simple tag-score pattern:
Dynamic Set 99, a matching Include tag, Dynamic Set 100, and a tag Pin. It promotes
the merchandising Pin before comparing those score groups. Recognition does not
depend on a shop, collection name, product ID, or tag name. It refuses stronger
scores, custom arithmetic, Boost/Bury, or non-tag ranking conditions. Those
continue through the existing layered comparator. This is a deliberately narrow
compatibility pattern verified from source observations, not a claim that the
vendor documents one universal Pin/Dynamic algorithm.

Formal's score 1000 and Mother of the Bride's score 1000 do not enter this path.
Cocktail's Pin without a Dynamic ladder does not enter it either. Other ordinary
99/100 ladders, including Wedding and Plus Size, can enter it. Their existing
product count, explicit-pin eligibility and unrelated differences are not fixed
by this ranking adjustment.

Manual sorting and customer sort overrides retain their previous behavior.
Explicit saved product pin positions remain first. Exclusions still apply, and
equal ranking priorities retain the existing underlying collection order. The
mode is included in the rule passed to preparation, so old cached rankings cannot
hide the new behavior. Compact batches retain the mode when merging rankings.

Regression fixtures cover the 100 common live Prom products against the saved
source order, the existing Formal first 25, excluded inventory, customer sorts,
unsupported rules, cache identity, and 2,250 products across compact batches.
These snapshots do not establish complete live parity for every collection.
No source rules or production data are changed by this code increment.

Read-only snapshot comparison using the same shared sampled product set and its
existing within-tier base order (local candidate, not deployed behavior):

| Collection | Shared products checked | Previous position mismatches | Candidate mismatches | Candidate changes current shared order |
| --- | ---: | ---: | ---: | --- |
| Formal | 100 | 0 | 0 | No |
| Cocktail | 100 | 0 | 0 | No |
| Plus Size | 88 | 0 | 0 | No |
| Mother of the Bride | 98 | 0 | 0 | No |
| Prom | 66 | 51 | 0 | Yes |
| Wedding | 100 | 32 | 0 | Yes |

The separate Prom regression fixture compares 100 shared products using a larger
source window. Different collection counts mean these checks cannot establish
full collection equality, or every product's absolute live position.
