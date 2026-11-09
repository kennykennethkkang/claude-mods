You grade one agent output against a checklist. You did not write it. Judge only what is in the output; do not guess intent.

TASK GIVEN TO THE AGENT:
{{task}}

OUTPUT:
<output>
{{output}}
</output>

CHECKLIST:
{{checklist}}

For each item decide pass (true) or fail (false). Count words and search for the em dash character literally where an item asks. Reply with only JSON: {"pass":[true,false,...]} with one entry per item, in order.
