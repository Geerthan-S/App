/*
 * JSR223 Assertion placed after the expect check: counts each race outcome
 * (OK, DUTY_CAPACITY_FILLED, ...). Parameters: the race name (seat|doctor).
 * It never fails the sample; race_verify.groovy judges the totals.
 */

String race = Parameters.trim()
props.get(race + '_outcomes').merge(vars.get('last_outcome'), 1, Integer::sum)
