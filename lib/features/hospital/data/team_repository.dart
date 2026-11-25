// Hospital team: roles, invitations and offboarding (blueprint §3.3).

import '../../../core/config/backend_config.dart';

class OrgRoles {
  /// What each role may do; the server enforces the same table.
  static const descriptions = {
    'owner': 'Everything, including billing-level decisions and owners',
    'admin': 'Manage the team, duties and assignments',
    'recruiter': 'Post and edit duties, shortlist and select doctors',
    'operations': 'Run assignments: check-ins, completion and issues',
    'member': 'Post duties and select doctors (legacy role)',
  };

  static String label(String role) => role.isEmpty ? role : role[0].toUpperCase() + role.substring(1);
}

class TeamRepository {
  static Future<Map<String, dynamic>> _call(String name, Map<String, dynamic> data) async {
    final result = await BackendConfig.functions.httpsCallable(name).call<Map<String, dynamic>>(data);
    return Map<String, dynamic>.from(result.data);
  }

  static List<Map<String, dynamic>> _list(Object? raw) =>
      (raw as List? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  static Future<TeamView> listMembers(String organizationId) async {
    final data = await _call('listOrgMembers', {'organizationId': organizationId});
    return TeamView(
      myRole: data['myRole'] as String? ?? 'member',
      canManage: data['canManage'] == true,
      members: _list(data['members']),
      invitations: _list(data['invitations']),
    );
  }

  static Future<void> invite({
    required String organizationId,
    required String role,
    String? phoneNumber,
    String? email,
  }) =>
      _call('inviteOrgMember', {
        'organizationId': organizationId,
        'role': role,
        if (phoneNumber != null) 'phoneNumber': phoneNumber,
        if (email != null) 'email': email,
      });

  static Future<void> changeRole(String organizationId, String userId, String role) =>
      _call('updateOrgMemberRole', {'organizationId': organizationId, 'userId': userId, 'role': role});

  static Future<void> remove(String organizationId, String userId) =>
      _call('removeOrgMember', {'organizationId': organizationId, 'userId': userId});

  static Future<void> revokeInvitation(String inviteId) => _call('revokeOrgInvitation', {'inviteId': inviteId});

  // ── Invitee side ────────────────────────────────────────

  static Future<List<Map<String, dynamic>>> myInvitations() async =>
      _list((await _call('listMyInvitations', {}))['invitations']);

  static Future<void> respond(String inviteId, {required bool accept}) =>
      _call('respondToInvitation', {'inviteId': inviteId, 'accept': accept});
}

class TeamView {
  final String myRole;
  final bool canManage;
  final List<Map<String, dynamic>> members;
  final List<Map<String, dynamic>> invitations;

  const TeamView({required this.myRole, required this.canManage, required this.members, required this.invitations});
}
