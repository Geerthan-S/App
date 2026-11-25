// Doctor scans the hospital's check-in / check-out QR code. The phone's
// location is read at the moment of scanning and sent with the code; the server
// compares it with the hospital branch and the agreed shift times.

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/errors/error_envelope.dart';
import '../data/business_repository.dart';

class AttendanceScannerScreen extends StatefulWidget {
  final bool checkIn;
  final String facilityName;

  const AttendanceScannerScreen({super.key, required this.checkIn, required this.facilityName});

  /// Opens the scanner; resolves to true when the scan was recorded.
  static Future<bool?> open(BuildContext context, {required bool checkIn, required String facilityName}) =>
      Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => AttendanceScannerScreen(checkIn: checkIn, facilityName: facilityName),
      ));

  @override
  State<AttendanceScannerScreen> createState() => _AttendanceScannerScreenState();
}

class _AttendanceScannerScreenState extends State<AttendanceScannerScreen> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates);
  bool _busy = false;
  String? _status;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Current position, or null when location is off or refused (the scan is still recorded and flagged).
  Future<Map<String, dynamic>?> _location() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return null;
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
      );
      return {
        'latitude': pos.latitude,
        'longitude': pos.longitude,
        'accuracyMeters': pos.accuracy,
        'isMocked': pos.isMocked,
      };
    } catch (_) {
      return null;
    }
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_busy) return;
    final raw = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstWhere(
          (v) => v.startsWith('HFATT1:'),
          orElse: () => '',
        );
    if (raw.isEmpty) {
      setState(() => _status = 'That is not a HealthForce attendance code.');
      return;
    }
    setState(() {
      _busy = true;
      _status = 'Checking your location…';
    });
    await _controller.stop();
    try {
      final location = await _location();
      if (mounted) setState(() => _status = 'Recording…');
      final result = await BusinessRepository.scanAttendanceCode(raw, location);
      if (!mounted) return;
      final notes = List<String>.from(result['notes'] as List? ?? const []);
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(widget.checkIn ? 'Checked in' : 'Checked out'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(notes.isEmpty
                  ? 'Recorded on time at ${widget.facilityName}.'
                  : 'Recorded. The hospital will be asked to acknowledge:'),
              for (final n in notes) Padding(padding: const EdgeInsets.only(top: 6), child: Text('• $n')),
              if (location == null)
                const Padding(
                  padding: EdgeInsets.only(top: 10),
                  child: Text('Turn on location next time so your attendance is verified on site.'),
                ),
            ],
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done'))],
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = e.message ?? (e.domainCode == 'ATTENDANCE_CODE_INVALID' ? 'Ask the hospital to show a new code.' : 'Could not record.');
      });
      await _controller.start();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = 'Could not record. Check your connection and scan again.';
      });
      await _controller.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: Text(widget.checkIn ? 'Scan check-in code' : 'Scan check-out code')),
      body: Stack(
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.lime, width: 3),
                borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
              ),
            ),
          ),
          Positioned(
            left: AppSpacing.gutter,
            right: AppSpacing.gutter,
            bottom: AppSpacing.xl,
            child: Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(color: colors.surface, borderRadius: BorderRadius.circular(AppSpacing.radiusMd)),
              child: Row(
                children: [
                  if (_busy) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                  if (_busy) const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      _status ?? 'Point the camera at the QR code on the hospital\'s phone at ${widget.facilityName}.',
                      style: AppTypography.bodyMedium(colors.textPrimary),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
