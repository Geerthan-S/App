/*
 * JSR223 PreProcessor: gives each race thread its own contender from the
 * fixtures race_setup.groovy stored. Parameters: the race name (seat|doctor).
 */

String race = Parameters.trim()
int i = ctx.getThreadNum()
List tokens = props.get(race + '_tokens')
if (tokens == null || i >= tokens.size()) {
    throw new IllegalStateException("No ${race} race fixture for thread ${i}; did the setup step fail?")
}
vars.put('race_token', tokens[i])
vars.put('race_duty', props.get(race + '_duties')[i])
vars.put('race_doctor', props.get(race + '_doctors')[i])
