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
import '../../../core/config/backend_config.dart';

class VerificationRepository {
  final FirebaseFunctions _functions;
  final FirebaseStorage _storage;

  VerificationRepository({
    FirebaseFunctions? functions,
    FirebaseStorage? storage,
  }) : _functions = functions ?? BackendConfig.functions,
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

  /// The server decides which case is current: it returns the open case for
  /// the profile's current revision, or opens a new review cycle when the
  /// previous case was decided or the credentials changed since.
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
    final response = await _functions.httpsCallable('createVerificationCase')
        .call<Map<String, dynamic>>({'subjectType': 'doctor', 'subjectId': uid});
    final createdId = response.data['caseId'] as String?;
    if (createdId == null || createdId.isEmpty) {
      throw StateError('Could not create verification case.');
    }
    return createdId;
  }

  /// Appeals a rejected case once, within 30 days; a different verifier decides.
  Future<void> submitAppeal({required String caseId, required String statement}) async {
    await _functions.httpsCallable('submitVerificationAppeal').call<Map<String, dynamic>>({
      'caseId': caseId,
      'statement': statement,
    });
  }

  /// Sends the case to the verifier queue, then records the request for an
  /// official-source check. The second call only adds the registry-check
  /// record; the case is already with verifiers once the first succeeds.
  Future<void> requestReview(String caseId) async {
    await _functions.httpsCallable('submitVerificationCase').call<Map<String, dynamic>>({
      'caseId': caseId,
    });
    try {
      await _functions.httpsCallable('verifyDoctorRegistration').call<Map<String, dynamic>>({
        'caseId': caseId,
      });
    } on FirebaseFunctionsException {
      // The case is submitted; a verifier can still record the source check.
    }
  }

  /// Opens the system file picker. Returns null when the doctor cancels.
  Future<PlatformFile?> pickEvidenceFile() async {
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
    if (_contentTypeOf(file) == null) {
      throw StateError('Choose a PDF, PNG, or JPEG document.');
    }
    return file;
  }

  /**
   * Uploads to the private Cloud Storage path
   * verification/doctor/{uid}/{caseId}/{uuid}.{ext}. A Storage trigger then
   * writes the verificationDocuments record the doctor and verifiers see.
   */
  Future<Map<String, dynamic>> uploadEvidence({
    required String caseId,
    required PlatformFile file,
  }) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) throw StateError('Sign in before uploading evidence.');
    final bytes = file.bytes!;
    final contentType = _contentTypeOf(file)!;
    final extension = file.extension!.toLowerCase();
    final objectName = '${const Uuid().v4()}.$extension';
    final uploaded = await _storage
        .ref('verification/doctor/$uid/$caseId/$objectName')
        .putData(
          bytes,
          SettableMetadata(
            contentType: contentType,
            customMetadata: {'uploadedBy': uid, 'originalName': file.name},
          ),
        );
    return {
      'fileName': file.name,
      'size': bytes.length,
      'storagePath': uploaded.ref.fullPath,
    };
  }

  static String? _contentTypeOf(PlatformFile file) =>
      switch (file.extension?.toLowerCase()) {
        'pdf' => 'application/pdf',
        'png' => 'image/png',
        'jpg' || 'jpeg' => 'image/jpeg',
        _ => null,
      };
}
