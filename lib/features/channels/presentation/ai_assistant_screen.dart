// HealthForce AI: a private clinical decision-support chat. One free question
// per account, then the AI plan. A photo can be attached only after the doctor
// confirms patient consent and that it shows no identifying details.

import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/errors/error_envelope.dart';
import '../../../core/widgets/state_views.dart';
import '../data/channel_repository.dart';

class AiAssistantScreen extends StatefulWidget {
  const AiAssistantScreen({super.key});

  @override
  State<AiAssistantScreen> createState() => _AiAssistantScreenState();
}

class _AiAssistantScreenState extends State<AiAssistantScreen> {
  final _question = TextEditingController();
  late Future<Map<String, dynamic>> _status = ChannelRepository.aiStatus();
  File? _image;
  bool _consent = false;
  bool _asking = false;

  Future<void> _pick() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 75, maxWidth: 1600);
    if (picked != null) setState(() => _image = File(picked.path));
  }

  Future<void> _ask() async {
    final q = _question.text.trim();
    if (q.length < 3) return;
    if (_image != null && !_consent) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Confirm patient consent before sending a photo.')));
      return;
    }
    setState(() => _asking = true);
    try {
      await ChannelRepository.ask(q, image: _image, consent: _consent);
      _question.clear();
      setState(() {
        _image = null;
        _consent = false;
        _status = ChannelRepository.aiStatus();
      });
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) return;
      if (e.domainCode == 'AI_QUOTA_EXCEEDED') {
        final go = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Free question used'),
            content: Text(e.message ?? 'Get the AI plan to keep asking.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')),
              ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('See AI plan')),
            ],
          ),
        );
        if (go == true && mounted) context.push('/premium');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: AppColors.rose, content: Text(e.message ?? 'Could not get an answer.')));
      }
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('HealthForce AI')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _status,
        builder: (context, statusSnap) {
          final status = statusSnap.data ?? const {};
          final notReady = statusSnap.hasData && (status['enabled'] != true || status['configured'] != true);
          return Column(
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.sm),
                color: AppColors.amber.withValues(alpha: 0.12),
                child: Text(
                  status['disclaimer'] as String? ?? 'AI decision support only. Verify before acting.',
                  style: AppTypography.bodySmall(colors.textPrimary),
                ),
              ),
              if (statusSnap.hasData && status['hasPlan'] != true)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xs),
                  child: Text('${status['freeQuestionsRemaining']} free question(s) left', style: AppTypography.bodySmall(colors.textMuted)),
                ),
              Expanded(
                child: notReady
                    ? const EmptyStateView(icon: Icons.auto_awesome_outlined, title: 'Coming soon', description: 'The AI assistant is not switched on yet.')
                    : StreamBuilder<List<Map<String, dynamic>>>(
                        stream: ChannelRepository.watchAiThread(),
                        builder: (context, snap) {
                          final messages = (snap.data ?? const []).reversed.toList();
                          if (messages.isEmpty) {
                            return const EmptyStateView(
                              icon: Icons.auto_awesome_outlined,
                              title: 'Ask a clinical question',
                              description: 'Describe the case. You can attach a de-identified photo, such as a skin lesion or an X-ray.',
                            );
                          }
                          return ListView.builder(
                            reverse: true,
                            padding: const EdgeInsets.all(AppSpacing.md),
                            itemCount: messages.length,
                            itemBuilder: (context, i) {
                              final m = messages[i];
                              final mine = m['role'] == 'user';
                              return Align(
                                alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                                child: Container(
                                  margin: const EdgeInsets.symmetric(vertical: 4),
                                  padding: const EdgeInsets.all(12),
                                  constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.85),
                                  decoration: BoxDecoration(
                                    color: mine ? colors.accentSoft : colors.surface,
                                    borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      if (mine && m['imagePath'] != null)
                                        Text('📷 Photo attached', style: AppTypography.bodySmall(colors.textMuted)),
                                      SelectableText(m['text'] as String? ?? '', style: AppTypography.bodyMedium(colors.textPrimary)),
                                    ],
                                  ),
                                ),
                              );
                            },
                          );
                        },
                      ),
              ),
              if (!notReady)
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.sm),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (_image != null) ...[
                          Row(children: [
                            ClipRRect(borderRadius: BorderRadius.circular(6), child: Image.file(_image!, width: 56, height: 56, fit: BoxFit.cover)),
                            const SizedBox(width: AppSpacing.xs),
                            Expanded(
                              child: CheckboxListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                value: _consent,
                                onChanged: (v) => setState(() => _consent = v ?? false),
                                title: const Text('The patient consented, and the photo shows no face, name or ID'),
                              ),
                            ),
                            IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _image = null)),
                          ]),
                        ],
                        Row(children: [
                          IconButton(tooltip: 'Attach photo', icon: const Icon(Icons.photo_camera_outlined), onPressed: _asking ? null : _pick),
                          Expanded(
                            child: TextField(
                              controller: _question,
                              minLines: 1,
                              maxLines: 5,
                              textCapitalization: TextCapitalization.sentences,
                              decoration: const InputDecoration(hintText: 'Describe the case…'),
                            ),
                          ),
                          IconButton(
                            icon: _asking ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
                            onPressed: _asking ? null : _ask,
                          ),
                        ]),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
