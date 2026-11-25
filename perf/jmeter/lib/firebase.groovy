/*
 * Minimal Firebase client for JMeter setup and verification steps (not for
 * measured traffic, which goes through HTTP samplers). Load it from a JSR223
 * element with:
 *
 *   def fb = evaluate(new File(org.apache.jmeter.services.FileServer.getFileServer().getBaseDir(), 'lib/firebase.groovy'))
 *
 * It reads its endpoints from the plan's variables (auth_url, functions_url,
 * firestore_docs, api_key, data_dir).
 */

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

class FirebaseClient {
    static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()

    String authUrl
    String functionsUrl
    String firestoreDocs
    String apiKey
    File dataDir

    Map request(String method, String url, Object body, String token) {
        def builder = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(60))
            .header('Content-Type', 'application/json')
        if (token) builder.header('Authorization', 'Bearer ' + token)
        def payload = body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(JsonOutput.toJson(body))
        def response = HTTP.send(builder.method(method, payload).build(), HttpResponse.BodyHandlers.ofString())
        def json = response.body() ? new JsonSlurper().parseText(response.body()) : null
        return [status: response.statusCode(), json: json]
    }

    String signIn(String email, String password) {
        def r = request('POST', authUrl + '/accounts:signInWithPassword?key=' + apiKey,
            [email: email, password: password, returnSecureToken: true], null)
        if (r.status != 200) throw new IllegalStateException('Sign-in failed for ' + email + ': ' + r.json)
        return r.json.idToken
    }

    /** Calls a callable and returns its `result`, throwing on any error response. */
    Map call(String name, String token, Map data) {
        def r = request('POST', functionsUrl + '/' + name, [data: data], token)
        if (r.status != 200) throw new IllegalStateException(name + ' failed: HTTP ' + r.status + ' ' + r.json)
        return r.json.result
    }

    /** Firestore REST: GET a document, returning its decoded fields. */
    Map getDoc(String path, String token) {
        def r = request('GET', firestoreDocs + '/' + path, null, token)
        if (r.status != 200) throw new IllegalStateException('GET ' + path + ' failed: HTTP ' + r.status + ' ' + r.json)
        return decode(r.json.fields)
    }

    /** Firestore REST: equality-filtered query on one collection, returning decoded documents. */
    List<Map> query(String collection, Map<String, String> equals, String token) {
        def filters = equals.collect { field, value ->
            [fieldFilter: [field: [fieldPath: field], op: 'EQUAL', value: [stringValue: value]]]
        }
        def where = filters.size() == 1 ? filters[0] : [compositeFilter: [op: 'AND', filters: filters]]
        def r = request('POST', firestoreDocs + ':runQuery',
            [structuredQuery: [from: [[collectionId: collection]], where: where]], token)
        if (r.status != 200) throw new IllegalStateException('Query ' + collection + ' failed: HTTP ' + r.status + ' ' + r.json)
        return r.json.findAll { it.document }.collect { decode(it.document.fields) }
    }

    static Object decodeValue(Map v) {
        if (v.containsKey('stringValue')) return v.stringValue
        if (v.containsKey('integerValue')) return v.integerValue as long
        if (v.containsKey('doubleValue')) return v.doubleValue
        if (v.containsKey('booleanValue')) return v.booleanValue
        if (v.containsKey('nullValue')) return null
        if (v.containsKey('timestampValue')) return v.timestampValue
        if (v.containsKey('mapValue')) return decode(v.mapValue.fields)
        if (v.containsKey('arrayValue')) return (v.arrayValue.values ?: []).collect { decodeValue(it) }
        return v
    }

    static Map decode(Map fields) {
        (fields ?: [:]).collectEntries { k, v -> [k, decodeValue(v)] }
    }

    /** Reads perf/data/<name>.csv (written by the seed script) into a list of row maps. */
    List<Map> csv(String name) {
        def lines = new File(dataDir, name).readLines().findAll { it }
        def header = lines[0].split(',', -1)
        return lines.drop(1).collect { line ->
            def cells = line.split(',', -1)
            [header.toList(), cells.toList()].transpose().collectEntries()
        }
    }
}

def baseDir = org.apache.jmeter.services.FileServer.getFileServer().getBaseDir()
return new FirebaseClient(
    authUrl: vars.get('auth_url'),
    functionsUrl: vars.get('functions_url'),
    firestoreDocs: vars.get('firestore_docs'),
    apiKey: vars.get('api_key'),
    dataDir: new File(baseDir, vars.get('data_dir')).canonicalFile,
)
