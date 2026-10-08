/**
 * Verification Repository
 * Handles communication with Cloud Functions Verification Engine and Cloud Storage evidence upload.
 */

import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:uuid/uuid.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:file_picker/file_picker.dart';
import '../domain/verification_models.dart';

class VerificationRepository {
  final FirebaseFunctions _functions;
  final FirebaseStorage _storage;

  VerificationRepository({
    FirebaseFunctions? functions,
    FirebaseStorage? storage,
  }) : _functions = functions ?? FirebaseFunctions.instance,
       _storage = storage ?? FirebaseStorage.instance;

  /**
   * Invokes the Cloud Function verifyDoctorRegistration
   * Runs the server-side VerificationService and ComparisonEngine.
   */
  Future<VerificationResult> verifyRegistration({
    required String caseId,
    required String council,
    required String registrationNumber,
    required String fullName,
    required String qualification,
  }) async {
    try {
      final callable = _functions.httpsCallable('verifyDoctorRegistration');
      final response = await callable.call<Map<String, dynamic>>({
        'caseId': caseId,
        'council': council,
        'registrationNumber': registrationNumber,
        'fullName': fullName,
        'qualification': qualification,
      });

      final data = Map<String, dynamic>.from(response.data as Map);
      return VerificationResult.fromMap(data);
    } on FirebaseFunctionsException {
      rethrow;
    }
  }

  Future<String> currentDoctorCaseId() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) throw StateError('Sign in before submitting evidence.');
    final profile = await FirebaseFirestore.instance
        .collection('doctors')
        .doc(uid)
        .get();
    if (!profile.exists) {
      throw StateError('Complete doctor onboarding first.');
    }
    final caseId = profile.data()?['verificationCaseId'] as String?;
    if (caseId != null && caseId.isNotEmpty) return caseId;
    final response = await _functions.httpsCallable('createVerificationCase')
        .call<Map<String, dynamic>>({'subjectType': 'doctor', 'subjectId': uid});
    final createdId = response.data['caseId'] as String?;
    if (createdId == null || createdId.isEmpty) {
      throw StateError('Could not create verification case.');
    }
    return createdId;
  }

  Future<void> submitCurrentCase() async {
    final caseId = await currentDoctorCaseId();
    await _functions.httpsCallable('submitVerificationCase').call<Map<String, dynamic>>({
      'caseId': caseId,
    });
  }

  /**
   * Secure document picker & upload to private Cloud Storage path
   * Path: verification/doctor/{uid}/{caseId}/{fileName}
   */
  Future<Map<String, dynamic>?> pickAndUploadEvidence({
    required String caseId,
    required String doctorUid,
  }) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid != doctorUid) {
      throw StateError('Sign in with the account submitting this evidence.');
    }
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg'],
      withData: true,
    );
    if (result == null || result.files.isEmpty) return null;
    final file = result.files.single;
    final bytes = file.bytes;
    if (bytes == null || bytes.isEmpty || bytes.length >= 10 * 1024 * 1024) {
      throw StateError('Choose a non-empty document smaller than 10 MB.');
    }
    final extension = file.extension?.toLowerCase();
    final contentType = switch (extension) {
      'pdf' => 'application/pdf',
      'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg',
      _ => throw StateError('Choose a PDF, PNG, or JPEG document.'),
    };
    final objectName = '${const Uuid().v4()}.$extension';
    final storageRef = _storage.ref(
      'verification/doctor/$uid/$caseId/$objectName',
    );
    final uploaded = await storageRef.putData(
      bytes,
      SettableMetadata(contentType: contentType),
    );
    return {
      'fileName': file.name,
      'size': bytes.length,
      'storagePath': uploaded.ref.fullPath,
      'uploadedAt': DateTime.now().toUtc().toIso8601String(),
    };
  }
}
