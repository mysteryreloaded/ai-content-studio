# Content safeguards: model licenses, EU AI Act Article 50, marking MP4 Assets, US rules

Research for ticket [#17](https://github.com/mysteryreloaded/ai-content-studio/issues/17), gathered 2026-10-22 from primary sources. Terms follow `CONTEXT.md` (Model, Workflow, Backend, Generation, Upload, Asset, User, Admin, Audit entry).

**Method.**

- **Read directly:** license texts and code, from GitHub repos cloned at the commits listed under [Sources](#sources), plus the Hugging Face API.
- **EU law:** the official Journal texts of Regulation (EU) 2024/1689 (AI Act) and Regulation (EU) 2026/1744 (Digital Omnibus on AI), downloaded from the EU Publications Office (CELLAR), since EUR-Lex itself blocks scripted access. The Commission's Code of Practice and Article 50 Guidelines were read as the PDFs it published.
- **Experiments:** the ffmpeg and C2PA behaviour was tested locally with ffmpeg 8.0.1 and the official `c2patool` v0.28.2 release binary.
- **California:** `leginfo.legislature.ca.gov` refused every fetch. California content therefore comes from an official Assembly committee analysis plus one law-firm alert, and is marked as such.

**Conventions.**

- Plain statements are **confirmed** from the cited source.
- **Inference:** marks my own reading.
- **Unconfirmed:** marks things I could not check against a primary source.
- This is a reading of the texts, not legal advice.

MiniMax H3's license was researched separately ([`docs/research/minimax-h3.md`](https://github.com/mysteryreloaded/ai-content-studio/blob/research/minimax-h3/docs/research/minimax-h3.md), "License") and is not redone here. It appears only in the comparison table.

## Summary

- **LTX 2.5 (LTX-2.x Community License, dated 2026-08-11).**
  - **SaaS hosting is expressly allowed** (§3). The condition is that the use restrictions (§4 and Attachment A, which includes Lightricks' Acceptable Use Policy by reference) are written into the terms that govern use, as enforceable provisions, and that users are told LTX is subject to them (§3.1). You must also "require all of your users … to comply" (§4).
  - **No UI attribution is required.** There is no trademark grant either (§8).
  - **No duty to offer a report channel or to suspend users.**
  - **There is a duty around marking (§6).** You must comply with "AI Regulations", which the license names as the EU AI Act and the California AI Transparency Act. You must not remove or disable any metadata, watermarking, provenance or "latent disclosure" that LTX-2.x includes or that is applied to Outputs for those regulations. Licensor may revoke the license if you do.
  - **The grant is worldwide.** The only territorial limits are sanctions and export rules (§7) and an undefined AUP ban on giving access to "unsupported locations".
  - **The revenue threshold is confirmed:** Entities with annual revenue of **at least US$10M**, counted across affiliates, need a paid licence (§2.1, §1.6).
  - **Two new flags:**
    - Attachment A item 20 bars use in a product that "directly competes with Licensor's commercial products or services" without a separate licence.
    - The AUP bans sexually explicit content outright.
  - **LTX-2's own Python pipelines gained opt-in invisible marking on 2026-10-18,** using Meta PixelSeal for video and AudioSeal for audio, off by default. Neither ComfyUI core nor `ComfyUI-LTXVideo` has it.
- **Wan 2.2: Apache-2.0, confirmed.** This holds for the GitHub code and for every Wan 2.2 and Fun checkpoint on Hugging Face.
  - Apache-2.0 has **no** use restrictions and no duties toward users of a hosted service.
  - The model cards add one non-licence sentence: "You are fully accountable for your use of the models", which must not involve sharing content that "violates applicable laws, causes harm…, disseminates personal information intended for harm, spreads misinformation, or targets vulnerable populations".
- **EU AI Act Article 50 has applied since 2 August 2026. It was not delayed in general.**
  - **Omnibus grace period:** the Digital Omnibus (Reg. 2026/1744, OJ 24.7.2026, in force 27.7.2026) gives a grace period to 2 December 2026, but only for 50(2) and only for systems **already on the market before 2 August 2026**.
  - **50(2):** the *provider* of a generative system must mark outputs in a machine-readable, detectable way that is effective, interoperable, robust and reliable.
  - **50(4):** the *deployer* who makes a deep fake must visibly disclose it.
  - **The Code of Practice** (final 10 June 2026, judged adequate on 8 July 2026) expects, for video:
    - **at least two layers:** digitally signed metadata **and** an imperceptible watermark, covering both the video and its audio;
    - a **free detection tool**;
    - an AUP clause banning removal of the marks.
    - Fingerprinting or logging is optional and not enough on its own. The Code never names C2PA.
  - **Who is the provider:** the Commission's Guidelines say it is whoever puts the generative *application* into service under its own name, which is the operator. It is not the weights publisher. Free and open-source models and components that are not themselves AI systems fall outside Article 50. Article 2(12)'s open-source exemption expressly excludes Article 50.
  - **No small-operator exemption** exists. SMEs, and since the Omnibus also small mid-caps, only get the lower of the two fine caps.
  - **Related:** the Omnibus also adds an Article 5 **ban on systems that generate non-consensual intimate imagery or CSAM** without "reasonable and adequate" safeguards. It applies from **2 December 2026**.
- **Marking an MP4 in the studio.**
  - **Plain ffmpeg tags:** the mp4 muxer keeps only standard keys such as `comment`, `description` and `title`. Custom keys need `-movflags use_metadata_tags`. The studio's current remux therefore already **drops ComfyUI's embedded `prompt` and `workflow` JSON** (tested).
  - **C2PA works on MP4 from a CLI subprocess.** `c2patool` signed a 15 MB 1080p file in about 0.13 s and added about 3.6 KB. It must be the **last** step, because any later `-c copy` remux strips the manifest (tested).
  - **No certificate purchase is needed to sign.** The test certificate or your own CA works, but validators report `signingCredential.untrusted` ("issuer couldn't be recognized"). A trusted signature needs a certificate from a CA on the C2PA trust list.
  - **Node bindings:** `@contentauth/c2pa-node` is a Node-API addon. Whether it runs under Bun is untested.
  - **Workflow-side nodes:** there are no maintained ComfyUI nodes for video C2PA or video watermarking, only image-only ones.
  - **Open-source video watermark:** Meta Video Seal and PixelSeal (MIT, PyTorch).
- **US.**
  - **California AI Transparency Act:** SB 1000, signed on 30 September 2026 according to a law-firm alert, appears to have **deleted the 1,000,000-user threshold**. If so, any person producing a publicly accessible GenAI system in California must embed latent disclosures and offer a free verification tool. The final statute text was not read.
  - **TAKE IT DOWN Act:** it has no size threshold. It reaches only a "covered platform" that serves the public and is mainly a forum for user-generated content. That probably excludes a private, Admin-approved studio with no sharing (**inference**).

## 1. LTX 2.5: the LTX-2.x Community License

**Identity.**

- `Lightricks/LTX-2.5` on Hugging Face carries `license: other`, `license_name: ltx-2.x-community-license-agreement` and `license_link: …/LTX-2/blob/main/LICENSE-2_x`. The repo is gated "auto": the gate text only asks for consent to Lightricks' privacy policy and marketing. There are no extra terms.
- The license is `LICENSE-2_x` in `Lightricks/LTX-2`, dated **11 August 2026**, and "applicable to all LTX-2.5 versions released since August 11, 2026". The Licensor is Lightricks Ltd (§1.8).
- The only change since publication was commit `69b6b7c` (2026-10-13). Ignoring whitespace, its diff changes only the licensing contact email, to `licensing@ltx.io`.
- The model card summarises the terms as: under $10M, "Commercial and production use at no cost under the LTX-2.x Community License"; over $10M, a paid Commercial Use Agreement; "Revenue is measured across the whole entity, including subsidiaries and affiliates under common control." The card has no attribution, safety or watermark section.

**Clause map for an operator hosting LTX for third-party users:**

| Clause | What it says (quoted or close paraphrase) |
|---|---|
| §1.6 | An Entity includes all affiliates "on an aggregative basis"; thresholds are counted "collectively". |
| §1.11 | "You" includes "usage of LTX-2.x in an end-use application". |
| §2.1 | Royalty-free, **worldwide** grant "for any purpose, subject to the restrictions set forth in Attachment A". "Entities with annual revenues of **at least $10,000,000**" (Commercial Entities) need a paid licence. Unlicensed use is a material breach, and Licensor may bill its standard fees for the period of use. |
| §2.2 | A Commercial Entity's free "Non-Commercial Purpose" excludes use "in direct interactions with or that has impact on end users". |
| §3 (preamble) | "You may host for third parties remote access purposes (e.g. software-as-a-service)…, provided that you meet the following conditions". |
| §3.1 | The use restrictions in §4 and all of Attachment A "MUST be included as an enforceable provision by you in any type of legal agreement (e.g. a license) governing the use and/or distribution". You must also "give notice to subsequent users you distribute to, that LTX-2.x … [is] subject to Section 4 and Attachment A in their entirety". |
| §3.2 | Give "third-party recipients of LTX-2.x" a copy of the Agreement. |
| §3.3, §3.4 | Mark modified files; retain copyright, patent, trademark and attribution notices. |
| §4 | Use only for lawful purposes; "You shall require all of your users who use LTX-2.x … to comply with the terms of this Section 4." |
| §5 | Licensor claims no rights in Output; "You are accountable for input …, the Output you generate and its subsequent uses." |
| §6 | Comply with "AI Regulations", explicitly "Regulation (EU) 2024/1689 (the 'EU AI Act') and the California AI Transparency Act (Cal. Bus. & Prof. Code § 22757 et seq.)", plus "any documentation made available by Licensor regarding compliance". The full obligations are in the text below the table. |
| §6 (2nd para) | Licensor intends LTX-2.x to be treated as a free and open-source GPAI model under AI Act Art. 53(2). You must not cause Licensor to lose that derogation. |
| §7 | You represent that "you and any users of LTX-2.x" are not in comprehensively sanctioned territories or on US restricted-party lists. |
| §8 | No trademark rights: "Nothing in this Agreement permits you to make use of Licensor's trademarks". |
| §12–§15 | New York law; ICC arbitration seated in New York. The consumer carve-out names the EU, UK and California. |
| §13 | Automatic termination on material breach, "including any use in violation of applicable AI Regulations". |
| Att. A | Incorporates the **Acceptable Use Policy** (static.lightricks.com, "Last Updated: March 30, 2026"), which Licensor may update; the version in effect at the time of use governs. Then 20 listed restrictions, including: (5) disseminating content "without expressly and intelligibly disclaiming that [it] is machine generated"; (7) impersonating others "(e.g. deepfakes)" without consent; (18) commercial users training other models on Outputs; (19) circumventing "watermarking, content provenance or latent disclosure functionalities"; (20) use in a product that "directly competes with Licensor's commercial products or services … without obtaining a separate commercial license". |

The §6 obligations in full:

- **Do not strip marks.** "You shall maintain (including within any application or service through which … any Output is made available), and shall not remove, disable, alter, or circumvent, any safety or security measures, disclosures, metadata, watermarking, content provenance, latent disclosure … included or embedded within LTX-2.x … or applied to any Output, in furtherance of AI Regulations".
- **Pass the duty on.** Include "equivalent obligations in any agreement governing your distribution".
- **Marking and labelling are yours.** "You are solely responsible for any transparency, disclosure, marking, or labeling obligations applicable to you … as a provider or deployer".
- **Revocation.** Licensor may revoke if you have modified LTX so it "is no longer capable of including any disclosure required by AI Regulations".
- **Indemnity** for violations of AI Regulations.

**The Acceptable Use Policy** (5 pages) defines "Products" as Lightricks' apps, web services and generative AI models, "made available on cloud-hosted basis and/or on-premises deployments". Items most relevant to a video studio:

- a complete ban under "Do Not Generate Sexually Explicit Content";
- child-safety bans, including "generating content designed to impersonate a minor";
- "Impersonate real entities or create fake personas without consent";
- "Facilitate or provide account access to persons or entities in unsupported locations", where "unsupported locations" is undefined;
- "You may not use any outputs … in applications involving unlawful pornography, defamation, hate speech, deepfakes, biometric identification, or other unlawful activity". It is ambiguous whether "deepfakes" there means only unlawful ones.
- "Where content … is used commercially, users must assume responsibility for ensuring it does not replicate any real-world likeness, person, brand, or location unless independently cleared."

**Answers to the ticket's questions:**

- **Must users be bound to use restrictions or an AUP? Yes.** The terms that govern use of a hosted service must contain §4 and Attachment A, AUP included, as enforceable provisions, and must tell users LTX is subject to them (§3.1, §4).
  - **Unconfirmed:** whether §3.2's "copy of this Agreement" also applies to hosted-service users, who receive no weights. §3.6 also speaks of providing the Agreement "with any such use".
- **Attribution or notice wording and placement? None required in the UI.** The only notice duties are the §3.1 notice to users and retention of existing notices in files you redistribute (§3.4). §8 grants no trademark rights.
  - **Inference:** naming the Model factually ("LTX 2.5") is ordinary nominative use, but the license neither grants nor requires it.
- **Duty to mark outputs, offer reporting or suspend users?**
  - **Marking:** there is no standalone duty to mark. There is a duty to comply with the EU AI Act and California law (which do require marking, see §4 and §6 below), a duty not to strip marks applied for them, and a duty to pass the same obligation on.
  - **Reporting and suspension:** not required by the license. Contrast H3 V.5. Lightricks' AUP mentions suspension only for its own accounts.
  - **Inference:** "require all of your users … to comply" implies some enforcement, but no mechanism is specified.
- **Territorial limits? None beyond sanctions and export control** (§7) and the undefined AUP phrase "unsupported locations". The grant is "worldwide" (§2.1).
- **Revenue threshold? Confirmed.** It reads "annual revenues of at least $10,000,000", across all affiliates, so exactly $10M already needs a paid licence. The license does not say which accounting period "annual" refers to.

**LTX's own marking code.** This shows what "latent disclosure functionalities" could mean in practice.

- `Lightricks/LTX-2` v1.5.0 (commit `e98f6d9`, 2026-10-18) added the package `ltx_pipelines.marking`. It applies **post-hoc Meta PixelSeal** (Video Seal family) to SDR frames before H.264 encoding, and **AudioSeal** to stereo PCM.
- It is opt-in through `--marker-root-path`: "Omit the flag for unchanged pixels / PCM". It needs extra Python extras and a local "marking pack" of five weight and config files, which "the library does not download".
- Both seals carry a fixed payload seeded with `0x4C5458` (ASCII "LTX"). The code comments call it "Not a signature and not a model version", and the docs say the marks are "**not** cryptographic signatures".
- There is no detect CLI, only a Python API. HDR output skips the video mark.
- The CHANGELOG does not mention it.
- Neither ComfyUI core (`1a82e6d`) nor `Lightricks/ComfyUI-LTXVideo` (`220e1d4`) contains any seal, watermark or provenance node.
- **Inference:** because marking is opt-in and absent from ComfyUI, running LTX in ComfyUI without it is unlikely to count as "removing" a capability under §6. The license does not address this.
- **Unconfirmed:** whether Lightricks publishes the marking pack, and the "documentation … regarding compliance" that §6 incorporates. Neither was found.

## 2. Wan 2.2: Apache-2.0

- `Wan-Video/Wan2.2` @ `1ea34ff` (2026-09-21) ships `LICENSE.txt`, which is the stock Apache License 2.0; it diffs clean against apache.org apart from whitespace. There is no `NOTICE` file.
- **Hugging Face metadata says `apache-2.0`** for:
  - `Wan-AI/Wan2.2-T2V-A14B`, `-I2V-A14B`, `-TI2V-5B`, `-Animate-14B`, `-S2V-14B` and `-Animate-2-14B`;
  - `alibaba-pai/Wan2.2-Fun-A14B-Control`, `-Control-Camera`, `-InP` and `-VACE-Fun-A14B`;
  - `lightx2v/Wan2.2-Distill-Loras`, `google/umt5-xxl` (the text encoder) and `Comfy-Org/Wan_2.2_ComfyUI_Repackaged`.
- None of the Wan-AI Hugging Face repos contains a LICENSE file; the card's relative `LICENSE.txt` link returns "Entry not found". `Wan-Video/Wan-Animate-2` has its own Apache-2.0 `LICENSE`.
- **Responsibility language**, identical in the GitHub README and in every Wan 2.2 model card under "License Agreement":

  > "We claim no rights over the your generated contents, granting you the freedom to use them while ensuring that your usage complies with the provisions of this license. You are fully accountable for your use of the models, which must not involve sharing any content that violates applicable laws, causes harm to individuals or groups, disseminates personal information intended for harm, spreads misinformation, or targets vulnerable populations. For a complete list of restrictions … refer to the full text of the license."

  - **Inference:** Apache-2.0 contains no such content restrictions. This sentence is therefore a statement of responsibility, not a licence condition that has to be passed on. An operator may choose to repeat it in its terms.
- **Apache-2.0 duties** (§4: licence copy, NOTICE, change notices) attach only to *redistributing* the Work. Serving Generations from a Backend redistributes nothing, so nothing is owed to users.
  - **Inference:** this assumes the operator does not hand out weights.
- Apache-2.0 has no attribution-in-UI, territorial, revenue, marking, reporting or suspension terms.

## 3. The three launch Models side by side

H3 cells are taken from `docs/research/minimax-h3.md`; the clause numbers are H3's.

| Duty on a hosting operator | LTX 2.5 | Wan 2.2 | MiniMax H3 |
|---|---|---|---|
| Bind users to use restrictions / AUP | **Yes**, as enforceable terms plus notice (§3.1, §4) | No | **Yes**, before access (V.2) |
| Give users the licence text | Unclear for SaaS (§3.2, §3.6) | No | Suggested (III.1) |
| UI attribution | No (no trademark grant, §8) | No | **"MiniMax H3" prominently**, if commercial (IV.2) |
| Mark outputs | Comply with EU AI Act and CA law; don't strip marks (§6) | No | Encouraged only (III.3(b)) |
| Disclosure by users when publishing | **Yes** (Att. A(5)) | No | **Yes** (Exhibit A.12) |
| Report channel / takedown / suspend repeat offenders | No | No | **Yes** (V.5) |
| Territory | Worldwide minus sanctions (§7) | Worldwide | **Outside EU, UK, KR, US only** (II, V.4) |
| Revenue threshold | Paid licence at ≥ US$10M, all affiliates (§2.1) | None | Written authorisation above US$20M (IV.1) |
| Sexual content | **Banned** by the AUP | Not addressed | AUP items |
| Competing-product clause | **Yes** (Att. A(20)) | No | No |

## 4. EU AI Act Article 50 as of 2026-10-22

### What it requires

The texts below are from the OJ text of Reg. 2024/1689, Art. 50, Art. 3 and Art. 2.

- **50(2), providers.** "Providers of AI systems, including general-purpose AI systems, generating synthetic audio, image, video or text content, shall ensure that the outputs of the AI system are marked in a machine-readable format and detectable as artificially generated or manipulated." The technical solutions must be "effective, interoperable, robust and reliable as far as this is technically feasible", taking into account content type, cost and "the generally acknowledged state of the art".
  - **Exceptions:** systems that perform "an assistive function for standard editing", or that "do not substantially alter the input data".
  - Recital 133 lists usable techniques: "watermarks, metadata identifications, cryptographic methods for proving provenance and authenticity of content, logging methods, fingerprints or other techniques". These can sit "at the level of the AI system or at the level of the AI model".
- **50(4), deployers.** "Deployers of an AI system that generates or manipulates image, audio or video content constituting a deep fake, shall disclose that the content has been artificially generated or manipulated."
  - For "evidently artistic, creative, satirical, fictional or analogous" work, the duty is limited to disclosure "in an appropriate manner that does not hamper the display or enjoyment of the work".
  - A *deep fake* (Art. 3(60)) is AI content "that resembles existing persons, objects, places, entities or events and would falsely appear to a person to be authentic or truthful".
- **50(5).** The information must be given "in a clear and distinguishable manner at the latest at the time of the first interaction or exposure", and must be accessible.

**How the Guidelines read these** (Commission Guidelines, Annex to C(2026) 5054 final, 20.7.2026):

- **Video with audio:** for video, "both video and audio content must be marked and detectability must be ensured" (pt. 60).
- **Marking needs detection:** marking without available detection "will not suffice" (pt. 70). Detection results must be human-readable (pt. 75).
- **Which Modes count as generation:**
  - In scope: "face replacement or substantial facial modification", "synthesis of realistic speech in a specific person's voice", and "generation of realistic video depicting events that did not occur".
  - Out of scope as standard editing: "rescaling of a video clip" and "format conversions" (pt. 92).
  - **Inference:** an upscale-only Mode may fall under the editing exception; text-to-video, image-to-video and character-replace Modes do not.
- **"Existing" is broad:** it covers anything that "exists, can plausibly exist or could have plausibly existed in reality". Only things that defy physics or biology fall out (pt. 113).
- **Deployers cannot rely on the provider's marks:** "deployers cannot rely on the machine-readable marking embedded in the content by the provider" (pt. 117).
- **Labels buried in terms do not count:** a label that is "part of terms of use that are often not read by users" is not clear and distinguishable (pt. 142).

### Dates: applied from 2 August 2026, with one narrow grace period

- **The original Act:** Art. 113 says the Regulation applies "from 2 August 2026", and Art. 50 sits in none of the earlier or later carve-outs.
- **The Digital Omnibus on AI** is Regulation (EU) **2026/1744** of 8 July 2026. It was published in the OJ on 24.7.2026, with Parliament's position of 16 June 2026 and the Council's decision of 29 June 2026. It entered into force on "the third day following that of its publication" (its Art. 4), which is 27 July 2026; its new Art. 113(d) also uses that date. For Article 50 it:
  - adds **Art. 111(4):** "Providers of AI systems … generating synthetic audio, image, video or text content, that have been placed on the market before 2 August 2026 shall take the necessary steps in order to comply with Article 50(2) by 2 December 2026." Recital 15 calls this "a transitional period of four months";
  - rewrites **Art. 50(7)** on codes of practice for "detection, marking and labelling". The Commission assesses a code's adequacy and may adopt an implementing act if the code is inadequate;
  - makes **no other change to Art. 50**. No point of the Omnibus amends 50(1)–(6).
- **The Guidelines confirm the reading** (pt. 153): Art. 50 applies from 2 August 2026 "regardless of their date of placement on the market". The grandfathering covers only 50(2), for systems placed on the market or put into service before that date. Content generated before 2 August 2026 need not be marked retroactively (pt. 154).
- **Inference:** a studio that has not launched by 2 August 2026 gets no grace period. Its in-scope Generations must be marked from launch.

### The Code of Practice on Transparency of AI-Generated Content

- **Status:**
  - The final text was published on **10 June 2026** (PDF, 38 pp.).
  - On 8 July 2026 the Commission concluded that it "adequately covers the obligations provided for in Articles 50(2), (4) and (5)", and the AI Board adopted its adequacy assessment the next day.
  - It is voluntary. Non-signatories must show "alternative adequate means", for example a gap analysis against the Code, and "may also be subject to a larger number of requests for information" (Guidelines pts. 147–148).
  - Signatories as of 31 July 2026: 95 for Section 1 and 192 for Section 2. Lightricks, Alibaba/Wan, MiniMax and Comfy were not on the list as fetched.
- **Section 1 (providers, 50(2)): techniques.**
  - **Measure 1.1:** "So long as no single marking technique can … ensure by itself compliance … for audio, images, video, and containerised text …, Signatories will implement a multi-layered marking approach … with at least two layers of machine-readable marking". The two layers are:
    - **1.1.1 Digitally signed metadata:** record in the metadata whether content is AI-generated; "All recorded information will be digitally signed and time-stamped … in a secure and tamper-evident manner". Secure handling of signing keys is required "except in circumstances where the deployment context does not permit the secure handling or provisioning of the key, for example in a local deployment scenario".
    - **1.1.2 Imperceptible watermark,** either post-hoc or at model level. Model providers are "encouraged" to watermark at model level so downstream providers can comply.
  - **1.1.3 Fingerprinting or logging** is *optional*, and "relying on fingerprinting or logging alone is not considered sufficient".
  - **The Code never names C2PA.** It speaks of "digitally signed metadata" and "relevant established standards". Measure 3.4 says interoperability standards exist so far only "for digitally signed metadata".
- **Section 1: duties beyond the marks themselves.**
  - **Measure 1.2(b):** put a ban on intentional removal of, or tampering with, the marks in the AUP or terms. For systems "provided under free and open-source licenses, it is sufficient … to alert users to this best practice in the documentation".
  - **Measure 1.3 (optional) provenance fields:** AI system name, provider company name and timestamp; optionally the model identifier and version.
  - **Measure 1.4 (optional):** offer users a one-click perceptible label.
  - **Measure 2.1, detection:**
    - The detector must be made available free of charge, as a public specification, software or an API.
    - Where the general public may be exposed to the content, the public must have access.
    - Access may be limited only where "effective safeguards … prevent further dissemination of the content to the general public".
    - A fee is allowed only above a reasonable volume, and only for providers with fewer than 1,000,000 monthly users.
  - **Measure 3.3, robustness:** the marks must survive re-compression, format change, cropping, scaling, screen recording and so on.
  - **Measure 3.4(c):** an interoperability solution for watermark detection by **2 February 2027**.
  - **Measure 4.2:** test before launch. Downstream providers "may rely on the results of testing performed by an upstream model provider or a third-party provider".
  - **SMEs:** recital (g) and Measures 2.4, 4.1 and 4.3 call for a "proportionate" approach for SMEs and SMCs; no measure is waived.
- **Section 2 (deployers, 50(4)): labels.**
  - The label is the EU "AI" icon or an equivalent label (Measure 1.1). For video it goes "in the top right corner", "at the beginning of the video as well as, where possible, at regular intervals" (1.2.2).
  - It must be "directly embedded into the content, unless equivalent alternatives … are available (e.g., a user interface overlay …)" (1.2.1(c)).
  - Artistic and creative works may carry a disclosure placed adjacent to the frame in the UI (Commitment 3).
  - **EU icons page:** "The icon must be visible when content is reshared or downloaded." The icons are free to use without attribution.

### Who is the "provider" when an operator self-hosts open weights

- **The rule.** A provider is whoever "develops an AI system … or that has an AI system … developed and … puts the AI system into service under its own name or trademark, whether for payment or free of charge" (Art. 3(3)). Putting into service means "the supply of an AI system for first use directly to the deployer or for own use in the Union" (Art. 3(11)).
- **The Commission's example** (Guidelines pt. 11): "a company provides a generative … AI application (e.g. … image generator …) on the Union market under its own name or trademark to consumers, professional users … The company is a provider responsible for compliance with … Article 50(1) and/or (2), regardless of whether the AI system is provided for free or for payment".
- **The model publisher is not the Art. 50 provider.**
  - "Article 50 AI Act does not explicitly apply to GPAI models" (pt. 27).
  - "Providers of free and open-source AI components that cover software, data, models, tools … and that do not constitute in themselves … an AI system, are not subject to the transparency obligations in Article 50" (pt. 24).
  - A system provider "may rely on the marking solution implemented by an upstream model provider … without prejudice to the responsibility of the provider of the AI system" (pt. 74).
- **Inference:** the operator who runs the studio with LTX, Wan or H3 weights for its Users is the Art. 50(2) provider. The weights publisher is not. The MIT studio repository on its own, without weights, is a component outside Art. 50. LTX §6 assigns marking to the licensee as well.
- **Deployers.** A deployer is whoever uses the system "under its authority" (Art. 3(4)). Here that is the signed-in User who generates and publishes a deep fake.
  - Users acting "in the course of a purely personal non-professional activity" are outside the deployer duties (Art. 2(10); Guidelines pts. 19–20).
  - That exclusion does **not** relieve the provider. In the Commission's example, a personal Christmas-card deep fake must still be marked by the provider (pt. 20).
  - The operator is also a deployer when it generates content for its own professional purposes (pt. 15).
- **Non-EU operators** are covered "where the output produced by the AI system is used in the Union" (Art. 2(1)(c)). "Incidental, unforeseeable or unauthorised downstream use should not alone trigger" that for systems not placed on the EU market (pt. 10).

### Exemptions and size

- **Open source:** Art. 2(12) exempts AI systems released under free and open-source licences "unless they are … put into service … as an AI system that falls under Article 5 or 50". There is no open-source exemption from Art. 50 (Guidelines pt. 23).
- **Small operators:**
  - There is no size exemption.
  - Fines for Art. 50 breaches reach up to €15M or 3% of worldwide turnover (Art. 99(4)(g)). For SMEs the cap is "whichever thereof is lower" (Art. 99(6)).
  - The Omnibus adds SME and SMC definitions and extends the lower-of cap to SMCs (new Art. 99(6a)), but gives no Art. 50 relief.
- **Other exclusions:**
  - scientific research and development, and pre-market testing (Art. 2(6), 2(8));
  - "industrial" or business-to-business outputs that stay inside the organisation and are "not intended to be shared outside the company" (Guidelines pt. 87);
  - real-time ephemeral content (pt. 88).
  - **Inference:** a studio whose Users can download Assets fits none of these.
- **Enforcement:** national market surveillance authorities. The AI Office is competent only where the same entity provides both the model and the system.

### Related: the new Article 5 ban on non-consensual intimate imagery (from 2 December 2026)

The Omnibus inserts Art. 5(1)(ba) and 5(1)(bb). From **2 December 2026** they prohibit "the placing on the market, the putting into service or the use of an AI system that generates or manipulates realistic images, videos, audio … of an identifiable natural person's intimate parts, or … engaged in sexually explicit activities, without that person's … explicit consent", and the same for CSAM.

- **For providers, the ban applies when** the system is meant to produce such material, or when it is "a reasonably foreseeable and reproducible outcome … and the system does not have reasonable and adequate technical safety measures and other safeguards to reliably prevent that generation … and to correct observed or reported misuse" (new Art. 5(1a)).
- **Recital 12 lists example safeguards:** "safe prompt design and output controls, runtime prompt guardrails, content classification and filtering mechanisms, usage restrictions, abuse detection mechanisms, and notice and action mechanisms". For "providers retaining effective control over AI systems, for instance through a platform or a web interface", it adds "following and reporting methods for misuse cases".
- **For deployers,** only use for that purpose is banned.
- **Fines:** Art. 5 breaches carry the highest fine tier, up to €35M or 7% of worldwide turnover (Art. 99(3)).
- **Inference:** a web studio with reference-image Uploads and character-replace Modes is the "platform or web interface" case. Whether open-weight video models make such output "reasonably foreseeable and reproducible" was not tested.

## 5. Machine-readable marking for MP4 Assets in a Bun + ffmpeg app

### (a) Plain ffmpeg metadata tags during the `-c copy` remux

These are local tests with ffmpeg 8.0.1, run on synthetic clips; the command transcripts are not kept in the repo.

- **Only standard keys survive by default.** ffmpeg's mp4/mov muxer writes only a fixed set of keys as iTunes-style atoms: `title`, `artist`, `album_artist`, `composer`, `album`, `date`, `encoder`/`encoding_tool`, `comment`, `genre`, `copyright`, `grouping`, `lyrics`, `description`, `synopsis`, `show`, `episode_id`, `network` and `keywords` (`libavformat/movenc.c`, `mov_write_ilst_tag`, tag n8.0.1). Any other key is **dropped silently** unless `-movflags use_metadata_tags` is set ("use mdta atom for metadata", ffmpeg-formats docs).
- **The studio's remux keeps those standard keys:** `-c copy -movflags +faststart -metadata comment="AI-generated …" -metadata description=…` wrote and read back `comment`, `description`, `title` and `copyright`.
- **Custom keys need the flag:** `-movflags +faststart+use_metadata_tags -metadata ai_generated=true` kept the custom key.
- **ComfyUI's embedded JSON.** ComfyUI's `SaveVideo` embeds the full `prompt` JSON, and `extra_pnginfo` when it is sent, as **custom** tags, written with `movflags=use_metadata_tags+faststart`. This happens unless ComfyUI runs with `--disable-metadata` (`comfy_extras/nodes_video.py`, `comfy_api/latest/_input_impl/video_types.py`, `comfy/cli_args.py` @ `1a82e6d`).
  - In the test, the studio's current remux, which has no `use_metadata_tags`, **dropped `prompt` and `workflow` and kept `comment`**.
  - **Inference:** today's Assets therefore probably do not carry the Workflow and prompt JSON. Adding `use_metadata_tags` to tag custom keys would bring them back, unless the remux also passes `-map_metadata -1`.
- **Fragility:**
  - A plain ffmpeg re-encode (`-c:v libx264 -c:a aac`) **kept** the global tags.
  - `-map_metadata -1` removed them all.
  - Tags are unsigned and anyone can change them.
  - **Unconfirmed:** what YouTube, Instagram, TikTok, WhatsApp and similar platforms keep. No primary source was checked. They all re-encode uploads, and keeping tags depends on each platform.
- **Fit with the Code:** plain tags are not "digitally signed" (Code 1.1.1) and are not a watermark (1.1.2). On their own they are a single unsigned layer.
- **Another metadata vocabulary:** IPTC's `DigitalSourceType` term `trainedAlgorithmicMedia` can be carried as XMP, for example with exiftool, which ffmpeg cannot write into MP4. That path was not tested here. C2PA uses the same IPTC term (see below).

### (b) C2PA / Content Credentials

- **Tooling:**
  - **`c2patool`** (`contentauth/c2patool`, MIT/Apache-2.0) has release v0.28.2 of 2026-10-08. Its release assets are prebuilt binaries for x86_64 Linux, universal macOS and x86_64 Windows; there is no Linux arm64 asset. The Linux binary is about 38 MB.
  - **`c2pa-rs`** (the Rust SDK) lists `mp4` (`video/mp4`) and `mov` as supported formats, with fragmented MP4 only for file-based Rust operations (`docs/supported-formats.md` @ `60f7cbd`).
  - **Node bindings:** `@contentauth/c2pa-node` 0.9.10 now lives in the `contentauth/c2pa-js` monorepo (`packages/c2pa-node`, MIT). The older `c2pa-node` and `c2pa-node-v2` repos are archived.
    - It is a **Neon / Node-API native addon** (`index.node`), `engines.node >= 22`. A postinstall script fetches prebuilt binaries for linux x64/arm64, macOS and Windows.
    - Bun says it "implements [Node-API] from scratch, so most existing Node-API extensions work with Bun out of the box" (bun.com/docs/runtime/node-api).
    - **Unconfirmed:** that this addon loads under Bun. It was not tested.
  - **Also available:** `c2pa-python`, `c2pa-cpp` and a browser WASM package (`c2pa-web`).
- **Tested** (c2patool v0.28.2 on the remuxed MP4, with a `c2pa.actions.v2` assertion of `c2pa.created` and `digitalSourceType` `…/trainedAlgorithmicMedia`):
  - **It works as a CLI subprocess:** `c2patool in.mp4 -m manifest.json -o out.mp4`. A 15 s 1080p 15.5 MB file took about **0.13 s** and grew by about **3.6 KB**, against about 0.18 s for the `-c copy` remux itself on the same machine. The manifest is a top-level `uuid` box before `moov`, so faststart order is kept, and the file still probes and plays in ffprobe.
  - **Signing must come last:** running the signed file through `ffmpeg -c copy -movflags +faststart` again produced a file where c2patool reports "**No claim found**".
  - **Inference:** a C2PA manifest added Workflow-side, inside ComfyUI, would be stripped by the studio's own remux. C2PA has to be added after the remux.
- **Certificates and how validators treat them:**
  - **Self-signed CAs are rejected as signers.** The SDK rejects a self-signed CA certificate used directly as the signing certificate: "certificate issuer and subject cannot be the same (self-signed disallowed)", giving `signingCredential.invalid` (`sdk/src/crypto/cose/certificate_profile.rs`). The docs say: "The CAI SDK does not allow you to use a self-signed certificate".
  - **A private chain is accepted but untrusted.** A private CA with an end-entity certificate works; the SDK even ships an `EphemeralSigner` that generates one. Such certificates "will not be considered trusted in the C2PA conformance sense".
  - **What the test showed:** with the bundled test certificate, the read-back showed `validation_state: "Valid"` together with `signingCredential.untrusted` ("signing certificate untrusted"). Adobe's Inspect shows "The Content Credential issuer couldn't be recognized" (CAI docs, test-certs). The C2PA Verify site, which still uses the frozen interim trust list, shows an unknown-source message (CAI docs, trust-lists).
  - **Trusted signatures need a listed CA.** "Conforming generator products must use a certificate from a CA on the C2PA trust list". As of April 2026 the listed CAs were DigiCert, SSL.com, Tauth Labs and Trufo (CAI docs, get-cert). The interim trust list was frozen on 1 January 2026.
  - **Unconfirmed:** prices, and whether any listed CA issues free or low-cost certificates to individuals.
- **Inference on the Code:** a C2PA manifest signed with an untrusted certificate is still "digitally signed metadata", but it does not authenticate the provider to validators. Whether the Code's key-handling carve-out for "a local deployment scenario" covers a self-hosted server is not stated.
- **Workflow-side ComfyUI nodes** (GitHub search, 2026-10-22):
  - `mikecaronna/comfyui_c2pa_signer` (MIT, 4 stars) signs **images** only, with c2patool's test certificates.
  - No video C2PA node was found.
  - Given the remux finding above, a Workflow-side manifest would not survive anyway.

### (c) Open-source invisible watermarking for video

- **Meta Video Seal** (`facebookresearch/videoseal` @ `870ca7f`, MIT): "All models, training code, and evaluation tools released under MIT license".
  - Models: **PixelSeal** (256 bits, December 2025, "SOTA robustness & imperceptibility"), **ChunkySeal** (1024 bits) and VideoSeal v1.0 (256 bits).
  - It is PyTorch. Embedding works on decoded frames, so used post-hoc it needs a decode, embed and **re-encode** cycle.
  - **AudioSeal** (`facebookresearch/audioseal`, MIT) covers the audio track. That matters because the Guidelines want audio marked too, and LTX 2.5 and H3 both output audio.
  - This is the pair LTX-2 integrated (§1).
- **Image-only frame watermarkers** that could run per frame in a Workflow: `TianDongL/Blind_watermark_Comfyui` (MIT; DWT-DCT-SVD via `blind_watermark`) and `CaptainGrock/ComfyUIInvisibleWatermark` (no licence; 12-character payload).
  - **Unconfirmed:** whether they survive H.264 compression of video.
- **No ComfyUI node** for Video Seal, PixelSeal or AudioSeal was found.
- **Removal tools exist,** for example `wiltodelta/ComfyUI-remove-ai-watermarks` ("removing visible and invisible AI watermarks, stripping metadata"). That bears on the Code's robustness measure.
- **Not open for video:** Adobe TrustMark is "an open-source universal watermarking system for images". Google's open release is SynthID **Text**.

### (d) Visible labels, for 50(4) and for comparison

- **In the Workflow:** ComfyUI core has a `TextOverlay` node ("Draw Text Overlay"; search aliases include "watermark"; top or bottom, left, centre or right). It runs on IMAGE batches before `SaveVideo`, so it adds **no extra encode**, because ComfyUI encodes the video anyway. The Code's suggested position is the top right corner; `TextOverlay` offers top-right.
- **In the studio:** ffmpeg `drawtext` or `overlay` needs a full re-encode. A 15 s 1080p clip took about 16 s with libx264 `-preset medium -crf 18` on an i9-13900H (20 threads), and every re-encode loses some quality.
- **AGPL alternative:** `kimara-ai/ComfyUI-Kimara-AI-Advanced-Watermarks` (AGPL-3.0) draws text or logo overlays on images and videos.

### Options and rough costs

These are facts and rough estimates only, not a choice.

| Option | What it adds | Rough cost or complexity | Limits |
|---|---|---|---|
| Standard ffmpeg tags (`comment`, `description`) in the existing remux | One unsigned metadata layer | About zero; a few arguments | Trivially stripped; not signed; not a watermark |
| C2PA via `c2patool` subprocess after the remux | Signed metadata with IPTC `trainedAlgorithmicMedia`; publicly verifiable by any C2PA reader | 38 MB binary per host OS; about 0.1 s and a few KB per Asset; manifest JSON and key handling | Untrusted with a self-made or test certificate; a trusted certificate costs money (price unknown); stripped by any re-mux or re-encode; no Linux arm64 build |
| C2PA via `@contentauth/c2pa-node` in-process | Same as above | Native addon; Bun compatibility untested | Same as above |
| Video Seal / PixelSeal plus AudioSeal | Imperceptible watermark, the Code's second layer | Python, PyTorch and GPU. Either a custom ComfyUI node on the Backend (none exists) or a studio-side decode, embed and re-encode. A public detector is also needed for the 50(2) detection duty and Code 2.1. Days to weeks of engineering; GPU seconds per clip unmeasured | Robust to common edits per Meta, not to determined removal |
| Visible label in the Workflow (`TextOverlay`) | Perceptible label (50(4)-style) | About zero extra compute; one node per Workflow | Burned into the pixels; changes the Asset |
| Visible label in the studio (ffmpeg) | Same | A full re-encode: about 1× real time on a fast CPU, plus quality loss | Same |

## 6. US rules and whether thresholds exclude a small operator

- **California AI Transparency Act** (Bus. & Prof. Code § 22757 et seq.; SB 942 (2024), amended by AB 853 (2025) and SB 1000 (2026)).
  - **Before SB 1000** (per the committee analysis's "Existing law"): a "covered provider" was a person that "creates, codes, or otherwise produces a generative artificial intelligence system that has over 1,000,000 monthly visitors or users and is publicly accessible within the geographic boundaries of the state". From **2 August 2026** such a provider had to:
    - embed a latent disclosure in AI image, video and audio (provider name, system name and version, time and date, a unique identifier);
    - offer a free AI detection tool;
    - offer an optional manifest disclosure;
    - require licensees by contract to keep disclosures, and revoke them if they don't.
  - **SB 1000 as amended on 9 June 2026** (Assembly Privacy and Consumer Protection Committee analysis, hearing of 16 June 2026). It "[e]xpands the act to cover all GenAI systems, not only those that have over 1 million monthly visitors or users". It also:
    - renames the detection tool a "disclosure verification tool", which may be a compliant third-party tool;
    - deletes the manifest-disclosure option;
    - requires provenance data to be "compliant, or interoperable with, widely adopted specifications adopted by an established standards-setting body";
    - adds an assistive-technology flag;
    - reduces the licensee response window to 72 hours, with no duty to monitor licensees;
    - carries an urgency clause.
  - **Enactment** (law-firm alert, Morrison Foerster, 1 Oct 2026; secondary): "Enacted on September 30, 2026", "takes effect immediately". The alert says the "one-million-user threshold" is eliminated.
    - **Unconfirmed:** the chaptered text and its chapter number. leginfo blocked access, and a search snippet citing "Chapter 861" could not be checked.
    - **Unconfirmed:** the $5,000-per-violation penalty for the core duties, which comes from secondary search results only.
  - **AB 853's later duties** (large online platforms and GenAI hosting platforms from 1 January 2027; capture-device makers from 2028) per the MoFo alert. A companion bill, AB 2713, reportedly rewrote the platform section. Not read.
  - **Inference:** a studio that distributes neither weights nor content to non-creators is neither kind of platform.
  - **Inference:** if SB 1000 removed the threshold as reported, a small operator whose studio is "publicly accessible" in California is a covered provider. Whether an invite-only, Admin-approved studio is "publicly accessible" is not defined in the material read. LTX §6 names this Act explicitly.
- **TAKE IT DOWN Act** (Pub. L. 119-12, approved 19 May 2025; read on govinfo).
  - **A "covered platform"** is a website or app "(i) that serves the public; and (ii)(I) that primarily provides a forum for user-generated content, including messages, videos, images, games, and audio files; or (II) for which it is in the regular course of trade or business … to publish, curate, host, or make available content of nonconsensual intimate visual depictions". It excludes services that consist "primarily of content that is not user generated but is preselected by the provider".
  - **There is no size threshold.**
  - **Duties:** within one year of enactment (that is, by 19 May 2026), a notice-and-removal process with a "clear and conspicuous notice", and removal "not later than 48 hours" after a valid request, plus "reasonable efforts" to remove identical copies. The FTC enforces, including against non-profits.
  - The Act's criminal provisions (publishing NCII or "digital forgeries") apply to persons regardless of platform.
  - **Inference:** a studio where each User's Assets are private to that User and Admins, with no sharing or feed, is probably not "primarily … a forum for user-generated content". The threshold question is about the kind of service, not its size.
- **Other US states:** not surveyed.

## Options and implications for the studio

These are listed with their costs, not chosen.

- **Terms of use.**
  - LTX requires §4 and Attachment A, AUP included, in the terms plus a notice. H3 requires V and Exhibit A before access.
  - The Code's Measure 1.2(b) adds a no-removal-of-marks clause, or a documentation alert for open-source systems.
  - Cost: per-Model terms text, and an acknowledgement before a User's first Generation with that Model.
- **Report, takedown and suspension.** Required only by H3 (V.5) among the three licenses. The new Art. 5 safeguards and the Code's deployer-side flagging encourage it, and TAKE IT DOWN requires it only for covered platforms. Disable and Audit entries already exist (#16, #9); a report button and Admin removal of another User's content would be new.
- **Machine-readable marking.** If the operator is an EU-facing Art. 50(2) provider, or a California covered provider:
  - the Code expects signed metadata, a watermark and a free detector;
  - C2PA after the remux is cheap to add; the watermark and detector are the expensive part (table above);
  - the studio could make marking per-Model or per-deployment, since the obligation falls on the operator, not the project.
- **Visible label.** This is for Users' 50(4) duty when they publish deep fakes.
  - Workflow-side `TextOverlay` costs no compute, but burns the label into every Asset.
  - A label applied at download time would need a re-encode.
  - A UI-only label does not survive download, and the EU icons page says the icon "must be visible when content is reshared or downloaded".
- **Self-hosting docs.**
  - The per-Model license facts: the table in §3.
  - The operator, not the project, is the Art. 50 provider, with no small-operator or open-source exemption.
  - 2 December 2026 is when the Art. 5 NCII ban starts.
  - `--disable-metadata` exists if the Workflow and prompt JSON should never be written.

## Open / unconfirmed

- Whether LTX §3.2's "copy of this Agreement" applies to hosted-service Users who receive no weights.
- Whether a self-hosted studio "directly competes" with Lightricks' commercial offerings (LTX Attachment A item 20). Lightricks runs LTX Studio and an API; "directly competes" is not defined.
- What "unsupported locations" means in Lightricks' AUP.
- Whether "deepfakes" in the AUP sentence "…unlawful pornography, defamation, hate speech, deepfakes, biometric identification, or other unlawful activity" covers lawful, consented deep fakes.
- Lightricks' "documentation … regarding compliance" with AI Regulations, which LTX §6 incorporates. None was found on GitHub or the model card. The LTX marking pack (`pixelseal.pth` and the rest) was not found published.
- Whether a free, non-commercial, private studio instance (for example, friends only) counts as "putting into service" under Art. 3(11), making its operator a provider. The Guidelines' examples all involve a company or organisation.
- Whether the Code's "local deployment scenario" key-handling exception covers self-hosted servers.
- Platform behaviour (YouTube, Meta, TikTok and others) toward MP4 metadata tags and C2PA on re-upload. No primary source was read.
- Whether `@contentauth/c2pa-node` loads under Bun.
- C2PA certificate prices from the listed CAs, and any free tier.
- The final enacted text of California SB 1000 (chapter number, threshold deletion, penalties) and of AB 2713, and whether an invite-only studio is "publicly accessible".
- GPU cost and robustness of PixelSeal or AudioSeal on real LTX, Wan or H3 Assets. Nothing was run.
- Whether open-weight LTX 2.5, Wan 2.2 or H3 can readily produce realistic intimate imagery from a reference Upload. This bears on the new Art. 5(1a) test. Not tested.

## Sources

- **LTX 2.5 license and code:**
  - `Lightricks/LTX-2` @ `e98f6d927d83c92ef2be6aec76c8440b19306e39` (2026-10-18): `LICENSE`, `LICENSE-2_x` (license date 2026-08-11; history `a95ab85` 2026-08-26 and `69b6b7c` 2026-10-13, the latter an email change only), `LICENSE-2` (2026-01-05), `README.md`, `CHANGELOG.md` (1.5.0), `packages/ltx-pipelines/src/ltx_pipelines/marking/*.py`, `packages/ltx-pipelines/docs/marking.md` and `installation.md`, `pyproject.toml`. The marking package is absent at `9ec55f9` (2026-10-02).
  - Hugging Face `Lightricks/LTX-2.5`: model card (web fetcher) and API `cardData` (sha `49b093a`, lastModified 2026-10-11, gated "auto"). Fetched 2026-10-22.
  - Lightricks Acceptable Use Policy, [static.lightricks.com/legal/ltx-acceptable-use-policy.pdf](https://static.lightricks.com/legal/ltx-acceptable-use-policy.pdf), "Last Updated: March 30, 2026" (PDF dated 2026-03-30).
  - `Lightricks/ComfyUI-LTXVideo` @ `220e1d45aa0469f518e982102fca4dca92a61862` (2026-10-20), searched for seal, watermark and provenance.
- **Wan 2.2 license:**
  - `Wan-Video/Wan2.2` @ `1ea34ff48f87168174e12956e200b1d908b1c5ff` (2026-09-21): `LICENSE.txt`, `README.md` "License Agreement".
  - Hugging Face API and model cards (fetched 2026-10-22): `Wan-AI/Wan2.2-T2V-A14B` (`c8c270b1`), `-I2V-A14B` (`206a9ee1`), `-TI2V-5B` (`921dbaf3`), `-Animate-14B` (`cb93a225`), `-S2V-14B` (`dab4e9c5`), `-Animate-2-14B` (`6e8f1973`); `alibaba-pai/Wan2.2-Fun-*`; `lightx2v/Wan2.2-Distill-Loras`; `google/umt5-xxl`; `nvidia/ChronoEdit-14B-Diffusers`; `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` (`ee6f4a40`).
  - `Wan-Video/Wan-Animate-2` `LICENSE` (raw.githubusercontent.com).
- **EU law and guidance:**
  - Regulation (EU) 2024/1689, OJ L, 12.7.2024 (CELEX 32024R1689, via publications.europa.eu CELLAR): Arts. 2, 3, 50, 99, 111, 113; recitals 97, 100, 102–104, 133–136.
  - Regulation (EU) 2026/1744 (Digital Omnibus on AI), OJ L, 24.7.2026 (CELEX 32026R1744, via CELLAR): recitals 10–15; amending points (7) Art. 5, (20) Art. 50(7), the Art. 99 amendment (paras. 1, 4(da), 6a), (39) Art. 111, (40) Art. 113; Art. 4.
  - European Commission, *Code of Practice on Transparency of AI-Generated Content* (final, PDF dated 2026-06-10, [document 129555](https://ec.europa.eu/newsroom/dae/redirection/document/129555)); [news item of 10 June 2026](https://digital-strategy.ec.europa.eu/en/news/commission-publishes-code-practice-marking-and-labelling-ai-generated-content); [policy page](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content).
  - [Commission opinion on the assessment of the Code](https://digital-strategy.ec.europa.eu/en/library/commission-opinion-assessment-code-practice-transparency-ai-generated-content) (8 July 2026).
  - [Signatories page](https://digital-strategy.ec.europa.eu/en/news/strong-backing-code-practice-transparency-ai-generated-content) (31 July 2026).
  - [EU icons page](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content).
  - Commission *Guidelines on the implementation of the transparency obligations for certain AI systems under Article 50*, Annex to C(2026) 5054 final, 20.7.2026 ([document 131215](https://ec.europa.eu/newsroom/dae/redirection/document/131215); [library page](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems), published 20 July 2026).
  - [Q&A: Transparency obligations under Article 50](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act). All fetched 2026-10-22.
- **ComfyUI:** `Comfy-Org/ComfyUI` @ `1a82e6d01f395b43275c77acd289af1eb7090bb9` (2026-10-21, v0.42.0): `comfy_extras/nodes_video.py` (`SaveVideo`), `comfy_api/latest/_input_impl/video_types.py`, `comfy_extras/nodes_text_overlay.py`, `comfy/cli_args.py`.
- **FFmpeg:**
  - `libavformat/movenc.c` at tag `n8.0.1` (raw GitHub mirror).
  - [ffmpeg-formats documentation](https://ffmpeg.org/ffmpeg-formats.html) (`movflags` `use_metadata_tags`).
  - Local tests with `ffmpeg 8.0.1-3ubuntu2` on synthetic `testsrc2` and `sine` clips, 2026-10-22.
- **C2PA:**
  - `contentauth/c2pa-rs` @ `60f7cbdc69ab7a2554fcc87eb4df77050814b2cf` (2026-10-16): `docs/supported-formats.md`, `sdk/src/crypto/cose/certificate_profile.rs`, `sdk/src/utils/ephemeral_signer.rs`, `sdk/src/builder.rs`, `sdk/src/settings/mod.rs`, `sdk/src/validation_results.rs`.
  - `contentauth/c2patool` @ `a123c04951df94f497e7da337904e4df13929900` (2026-10-21): `README.md`, `docs/signing.md`, `docs/manifest.md`, `docs/usage.md`. Release v0.28.2 (2026-10-08) `x86_64-unknown-linux-gnu` binary, used for the signing test.
  - `contentauth/c2pa-js` @ `7036c209469116a0a19232b7c19fe5e14e67370b` (2026-10-19): `packages/c2pa-node` (`package.json` 0.9.10, `README.md`, `scripts/postinstall.cjs`).
  - `contentauth/c2pa-node-v2` @ `6472264` (archived; README archive notice); GitHub API for archive status of `c2pa-node` and `c2pa-node-v2`.
  - `contentauth/opensource.contentauth.org` @ `63da3ab58149740bd3233a60441791cc9265cefd` (2026-10-20): `docs/signing/get-cert.md`, `docs/signing/test-certs.md`, `docs/conformance/trust-lists.mdx`, `docs/durable-cr/trustmark-intro.md`.
- **Bun:** [bun.com/docs/runtime/node-api](https://bun.com/docs/runtime/node-api), fetched 2026-10-22.
- **Watermarking:**
  - `facebookresearch/videoseal` @ `870ca7fb33578b90f14c602016b6c2788096226e` (2026-07-02) `README.md` and `LICENSE`.
  - GitHub API licence metadata for `facebookresearch/audioseal`, `ShieldMnt/invisible-watermark`, `adobe/trustmark` and `google-deepmind/synthid-text`.
  - GitHub repository search (2026-10-22) and READMEs of `mikecaronna/comfyui_c2pa_signer`, `TianDongL/Blind_watermark_Comfyui`, `CaptainGrock/ComfyUIInvisibleWatermark`, `kimara-ai/ComfyUI-Kimara-AI-Advanced-Watermarks` and `wiltodelta/ComfyUI-remove-ai-watermarks`. These are third-party repos; they show what exists, not that it works.
- **US:**
  - California Assembly Committee on Privacy and Consumer Protection, analysis of SB 1000 (Becker) as amended 9 June 2026, hearing 16 June 2026 ([apcp.assembly.ca.gov/media/1177](https://apcp.assembly.ca.gov/media/1177)).
  - Morrison Foerster, "California Revamps AI Transparency Requirements", 1 Oct 2026 ([mofo.com](https://www.mofo.com/resources/insights/261001-california-revamps-ai-transparency-requirements)); secondary.
  - leginfo.legislature.ca.gov returned HTTP 403 to every fetch.
  - TAKE IT DOWN Act, Pub. L. 119-12, 139 Stat. 55 ([govinfo PLAW-119publ12](https://www.govinfo.gov/content/pkg/PLAW-119publ12/html/PLAW-119publ12.htm)), §§ 3–4.
- **Studio context:** `CONTEXT.md` @ `cd29cbc`; `docs/research/minimax-h3.md` on `origin/research/minimax-h3` (`a70f02c`); `docs/research/ltx-2-5-modes.md` on `origin/research/ltx-2-5-modes`; issue #17 and its comments.
