/**
 * App-Wide Connectivity Gate
 *
 * Wraps the routed app content and swaps in NoConnectionScreen whenever the
 * device has no network connectivity, resuming automatically once it comes
 * back (in addition to the screen's own manual Retry button).
 */

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import '../errors/error_screens.dart';

class ConnectivityGate extends StatefulWidget {
  final Widget child;

  const ConnectivityGate({super.key, required this.child});

  @override
  State<ConnectivityGate> createState() => _ConnectivityGateState();
}

class _ConnectivityGateState extends State<ConnectivityGate> {
  final _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _isOffline = false;

  @override
  void initState() {
    super.initState();
    _checkNow();
    _subscription = _connectivity.onConnectivityChanged.listen(_handleResult);
  }

  Future<void> _checkNow() async {
    final result = await _connectivity.checkConnectivity();
    if (mounted) _handleResult(result);
  }

  void _handleResult(List<ConnectivityResult> result) {
    final offline = result.isEmpty || result.every((r) => r == ConnectivityResult.none);
    if (mounted) setState(() => _isOffline = offline);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_isOffline) {
      return NoConnectionScreen(onRetry: _checkNow);
    }
    return widget.child;
  }
}
