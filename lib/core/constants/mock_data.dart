/**
 * Centralized Mock/Test Data — Shared Across Screens
 * Single source of truth until real backend-driven data replaces it.
 */

class MockData {
  static const String currentDoctorName = 'Dr. Aravind Swaminathan';

  // `final` (not `const`) so newly created posts can be appended at runtime
  // via MockData.duties.add(...) without introducing a separate data store.
  static final List<Map<String, dynamic>> duties = [
    {
      'dutyId': 'duty_chennai_gm_01',
      'facilityName': 'Apollo Specialty Hospital',
      'city': 'Chennai',
      'distanceKm': 4.2,
      'department': 'ICU & Emergency',
      'specialtyName': 'General Medicine',
      'qualificationRequired': 'MBBS, MD / DNB',
      'startAt': 'Tomorrow, 08:00 AM',
      'endAt': 'Tomorrow, 04:00 PM',
      'shiftType': 'Morning Shift (8 hrs)',
      'headcount': 2,
      'remainingHeadcount': 1,
      'amount': 6500,
      'basis': 'per_shift',
      'isVerifiedOrg': true,
      'status': 'published',
    },
    {
      'dutyId': 'duty_blr_er_02',
      'facilityName': 'Fortis Hospital - Bannerghatta',
      'city': 'Bengaluru',
      'distanceKm': 8.7,
      'department': 'Emergency Triage',
      'specialtyName': 'Emergency & Critical Care',
      'qualificationRequired': 'MBBS, MEM / MD',
      'startAt': '18 Sep, 08:00 PM',
      'endAt': '19 Sep, 08:00 AM',
      'shiftType': 'Night Duty (12 hrs)',
      'headcount': 1,
      'remainingHeadcount': 1,
      'amount': 9000,
      'basis': 'per_shift',
      'isVerifiedOrg': true,
      'status': 'published',
    },
    {
      'dutyId': 'duty_hyd_ped_03',
      'facilityName': 'Rainbow Children Hospital',
      'city': 'Hyderabad',
      'distanceKm': 12.1,
      'department': 'Pediatric Outpatient',
      'specialtyName': 'Pediatrics',
      'qualificationRequired': 'MD Pediatrics',
      'startAt': '20 Sep, 10:00 AM',
      'endAt': '20 Sep, 06:00 PM',
      'shiftType': 'Day Shift (8 hrs)',
      'headcount': 1,
      'remainingHeadcount': 1,
      'amount': 7000,
      'basis': 'per_shift',
      'isVerifiedOrg': true,
      'status': 'published',
    },
    {
      'dutyId': 'duty_pune_anes_04',
      'facilityName': 'CarePlus Multispecialty Clinic',
      'city': 'Pune',
      'distanceKm': 6.5,
      'department': 'Operation Theatre',
      'specialtyName': 'Anesthesiology',
      'qualificationRequired': 'MD Anesthesiology',
      'startAt': '22 Sep, 09:00 AM',
      'endAt': '22 Sep, 05:00 PM',
      'shiftType': 'Day Shift (8 hrs)',
      'headcount': 1,
      'remainingHeadcount': 1,
      'amount': 8000,
      'basis': 'per_shift',
      'isVerifiedOrg': true,
      'status': 'published',
    },
  ];

  // Dummy/sample data — no hospital-profile or review backend exists yet.
  static const Map<String, dynamic> hospitalProfile = {
    'name': 'Apollo Specialty Hospital',
    'orgType': 'Multi-Specialty Tertiary Care',
    'city': 'Chennai',
    'address': '21 Greams Lane, Thousand Lights, Chennai, TN 600006',
    'phone': '+91 44 2829 0200',
    'isVerified': true,
    'rating': 4.6,
    'about':
        'A leading multi-specialty hospital known for advanced critical care, '
        '24/7 emergency services, and a strong network of verified consulting doctors.',
  };

  static const List<Map<String, dynamic>> doctorReviews = [
    {
      'reviewerName': 'ICU Nurse Coordinator',
      'rating': 5,
      'comment': 'Extremely reliable during night shifts and calm under pressure.',
    },
    {
      'reviewerName': 'Dr. Priya Menon',
      'rating': 5,
      'comment': 'Great clinical judgement, always communicates clearly with the team.',
    },
    {
      'reviewerName': 'Hospital Admin Desk',
      'rating': 4,
      'comment': 'Punctual and professional throughout the assignment.',
    },
  ];

  static const List<Map<String, dynamic>> hospitalReviews = [
    {
      'reviewerName': 'Dr. Aravind Swaminathan',
      'rating': 5,
      'comment': 'Well-organized duty desk and smooth onboarding for on-demand shifts.',
    },
    {
      'reviewerName': 'Dr. Karthik Iyer',
      'rating': 4,
      'comment': 'Good infrastructure and payments were processed on time.',
    },
    {
      'reviewerName': 'Dr. Sneha Rao',
      'rating': 5,
      'comment': 'Supportive nursing staff and a clear shift handover process.',
    },
  ];

  // Mock conversations — one per seeded duty, plus any created on demand via
  // conversationForDuty() when a doctor taps "Interested / Chat" on a post
  // that doesn't have a scripted conversation yet (e.g. a newly Added Post).
  // `final` (not `const`) so sending a message / opening a new chat can
  // mutate these lists in place, same pattern as MockData.duties.
  static final List<Map<String, dynamic>> conversations = [
    {
      'conversationId': 'conv_duty_chennai_gm_01',
      'dutyId': 'duty_chennai_gm_01',
      'hospitalName': 'Apollo Specialty Hospital',
      'lastMessage': "₹6,500 works for me. I'll take the duty.",
      'lastMessageTime': '10:42 AM',
      'unreadCount': 0,
      // Doctor's personal status for this duty (separate from the duty's own
      // public `status`, e.g. 'published') — drives Profile's "My Duties".
      'dutyStatus': 'confirmed',
    },
    {
      'conversationId': 'conv_duty_blr_er_02',
      'dutyId': 'duty_blr_er_02',
      'hospitalName': 'Fortis Hospital - Bannerghatta',
      'lastMessage': 'We can increase it to ₹9,000 for the night shift. Let us know.',
      'lastMessageTime': 'Yesterday',
      'unreadCount': 2,
      'dutyStatus': 'negotiating',
    },
    {
      'conversationId': 'conv_duty_hyd_ped_03',
      'dutyId': 'duty_hyd_ped_03',
      'hospitalName': 'Rainbow Children Hospital',
      'lastMessage': 'Great, thank you for confirming your availability!',
      'lastMessageTime': 'Mon',
      'unreadCount': 0,
      'dutyStatus': 'confirmed',
    },
    // Doctor-initiated conversation — the doctor reaches out first, rather
    // than the hospital opening the chat (the other three examples above).
    {
      'conversationId': 'conv_duty_pune_anes_04',
      'dutyId': 'duty_pune_anes_04',
      'hospitalName': 'CarePlus Multispecialty Clinic',
      'lastMessage': 'Perfect, see you on 22 Sep. Thank you!',
      'lastMessageTime': 'Last week',
      'unreadCount': 0,
      'dutyStatus': 'confirmed',
    },
  ];

  static final Map<String, List<Map<String, dynamic>>> chatMessages = {
    'conv_duty_chennai_gm_01': [
      {
        'sender': 'hospital',
        'text': 'Hello Dr. Aravind, are you available for the ICU & Emergency duty tomorrow morning?',
        'time': '10:30 AM',
      },
      {
        'sender': 'doctor',
        'text': "Yes, I'm available. Could you share the compensation for the shift?",
        'time': '10:32 AM',
      },
      {
        'sender': 'hospital',
        'text': 'The offered compensation is ₹6,000 for the 8-hour shift.',
        'time': '10:35 AM',
      },
      {
        'sender': 'doctor',
        'text': 'Would it be possible to offer ₹7,000 considering the timing and emergency nature of the duty?',
        'time': '10:38 AM',
      },
      {
        'sender': 'hospital',
        'text': 'We can increase it to ₹6,500.',
        'time': '10:40 AM',
      },
      {
        'sender': 'doctor',
        'text': "₹6,500 works for me. I'll take the duty.",
        'time': '10:42 AM',
      },
    ],
    'conv_duty_blr_er_02': [
      {
        'sender': 'hospital',
        'text': 'Hi Dr. Aravind, we have an urgent Emergency Triage night duty on 18 Sep. Are you available?',
        'time': 'Yesterday, 6:05 PM',
      },
      {
        'sender': 'doctor',
        'text': "I can do it. What's the compensation for the 12-hour shift?",
        'time': 'Yesterday, 6:12 PM',
      },
      {
        'sender': 'hospital',
        'text': 'We are offering ₹8,500 for the night shift.',
        'time': 'Yesterday, 6:15 PM',
      },
      {
        'sender': 'doctor',
        'text': 'Given it is an overnight emergency shift, would ₹9,500 be possible?',
        'time': 'Yesterday, 6:20 PM',
      },
      {
        'sender': 'hospital',
        'text': 'We can increase it to ₹9,000 for the night shift. Let us know.',
        'time': 'Yesterday, 6:25 PM',
      },
    ],
    'conv_duty_hyd_ped_03': [
      {
        'sender': 'hospital',
        'text': 'Hi Dr. Aravind, we would like to confirm you for the Pediatric Outpatient duty on 20 Sep. The compensation is ₹7,000 for the day shift. Interested?',
        'time': 'Mon, 9:00 AM',
      },
      {
        'sender': 'doctor',
        'text': "Yes, ₹7,000 works for me. I'll take the duty.",
        'time': 'Mon, 9:10 AM',
      },
      {
        'sender': 'hospital',
        'text': 'Great, thank you for confirming your availability!',
        'time': 'Mon, 9:12 AM',
      },
    ],
    'conv_duty_pune_anes_04': [
      {
        'sender': 'doctor',
        'text': "Hi, I noticed you've posted an Anesthesiology duty for 22 Sep. I'd like to express my interest — is the position still available?",
        'time': 'Last week, 9:00 AM',
      },
      {
        'sender': 'hospital',
        'text': 'Hello Dr. Aravind, yes it is still open. Thank you for reaching out!',
        'time': 'Last week, 9:05 AM',
      },
      {
        'sender': 'doctor',
        'text': 'Great. Could you confirm the compensation and OT case load for the shift?',
        'time': 'Last week, 9:07 AM',
      },
      {
        'sender': 'hospital',
        'text': "It's ₹7,500 for the 8-hour shift, covering 3-4 elective OT cases.",
        'time': 'Last week, 9:10 AM',
      },
      {
        'sender': 'doctor',
        'text': 'Considering the case load, would ₹8,000 be possible?',
        'time': 'Last week, 9:12 AM',
      },
      {
        'sender': 'hospital',
        'text': 'Yes, we can do ₹8,000. Looking forward to having you.',
        'time': 'Last week, 9:15 AM',
      },
      {
        'sender': 'doctor',
        'text': 'Perfect, see you on 22 Sep. Thank you!',
        'time': 'Last week, 9:16 AM',
      },
    ],
  };

  /// Returns the existing conversation for [duty] if one exists, otherwise
  /// creates a new one seeded with a short opening message from the hospital.
  static Map<String, dynamic> conversationForDuty(Map<String, dynamic> duty) {
    final dutyId = duty['dutyId'] as String;

    for (final conversation in conversations) {
      if (conversation['dutyId'] == dutyId) return conversation;
    }

    final conversationId = 'conv_$dutyId';
    final newConversation = <String, dynamic>{
      'conversationId': conversationId,
      'dutyId': dutyId,
      'hospitalName': duty['facilityName'],
      'lastMessage':
          'Hello ${currentDoctorName.split(' ').last}, thanks for your interest in the '
          '${duty['specialtyName']} duty. Let us know if you have any questions.',
      'lastMessageTime': 'Just now',
      'unreadCount': 1,
      'dutyStatus': 'pending',
    };

    conversations.insert(0, newConversation);
    chatMessages[conversationId] = [
      {
        'sender': 'hospital',
        'text': newConversation['lastMessage'],
        'time': 'Just now',
      },
    ];

    return newConversation;
  }

  /// Duties the doctor is actively engaged with (has a conversation for) —
  /// each entry pairs the full duty map with its conversation, for
  /// Profile's "My Duties" section. Reuses `duties` and `conversations`;
  /// no separate data model.
  static List<Map<String, dynamic>> get myDuties {
    return conversations
        .map((conversation) {
          final duty = duties.firstWhere(
            (d) => d['dutyId'] == conversation['dutyId'],
            orElse: () => <String, dynamic>{},
          );
          return {'duty': duty, 'conversation': conversation};
        })
        .where((entry) => (entry['duty'] as Map).isNotEmpty)
        .toList();
  }

  // Mock notifications feed. `type` drives the icon and, together with
  // `conversationId` / `dutyId`, where tapping a notification navigates:
  // a conversationId opens that Chat, otherwise a dutyId opens Duty Details.
  // `final` (not `const`) so opening a notification can mark it read in place.
  static final List<Map<String, dynamic>> notifications = [
    {
      'notificationId': 'notif_offer_countered',
      'type': 'message',
      'title': 'Hospital countered your offer',
      'body': 'Fortis Hospital - Bannerghatta increased the compensation to ₹9,000 for the Emergency Triage night duty.',
      'time': 'Yesterday',
      'isRead': false,
      'conversationId': 'conv_duty_blr_er_02',
    },
    {
      'notificationId': 'notif_duty_confirmed',
      'type': 'confirmed',
      'title': 'Duty confirmed',
      'body': 'Your Anesthesiology duty at CarePlus Multispecialty Clinic on 22 Sep is confirmed at ₹8,000.',
      'time': 'Last week',
      'isRead': false,
      'conversationId': 'conv_duty_pune_anes_04',
    },
    {
      'notificationId': 'notif_new_duty',
      'type': 'new_duty',
      'title': 'New nearby duty matching your specialty',
      'body': 'General Medicine duty published at Apollo Specialty Hospital, Chennai.',
      'time': '2 hours ago',
      'isRead': false,
      'dutyId': 'duty_chennai_gm_01',
    },
    {
      'notificationId': 'notif_verification',
      'type': 'verification',
      'title': 'Verification in progress',
      'body': 'Your medical council registration document has been claimed by a platform verifier.',
      'time': '2 days ago',
      'isRead': true,
    },
  ];

  static int get unreadNotificationCount =>
      notifications.where((n) => n['isRead'] == false).length;
}
