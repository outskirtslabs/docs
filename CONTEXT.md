# Outskirts Labs Documentation

This context defines the language used to collect, version, and publish documentation for Outskirts Labs open source projects.

## Language

### Site and projects

**Docs site**:
The published collection of project documentation and guidance shared across Outskirts Labs projects.
_Avoid_: Documentation portal

**Project**:
An open source codebase whose documentation may appear on the docs site. Projects include libraries, applications, demonstrations, and reference material.
_Avoid_: Library, when referring to every project

**Adopted project**:
A project whose documentation and metadata are registered for inclusion in the docs site.
_Avoid_: Supported project, covered project

**Documentation component**:
The versioned body of documentation published for one adopted project. Its public identity may differ from the repository or artifact name.
_Avoid_: Project, when referring specifically to its published documentation

**Documentation version**:
A named edition of a documentation component. A component may have an unreleased edition and one or more released editions.
_Avoid_: Branch

**Next**:
The unreleased documentation version that describes ongoing project development.
_Avoid_: Latest

**Latest**:
The moving reference to a component's newest released documentation version. It never refers to Next.
_Avoid_: Next

**Released documentation**:
A documentation version that corresponds to a published project release or release line.
_Avoid_: Stable documentation

### Metadata and discovery

**Project manifest**:
The canonical metadata record an adopted project supplies to the docs site. It describes the project's identity, documentation, repository, platforms, and status.
_Avoid_: Site configuration

**Home catalog**:
The generated project and release listings on the docs site home page.
_Avoid_: Libraries table

### Project status

**Project status**:
The canonical statement of a project's maturity and expected maintenance. Every adopted project has one of five statuses: Experimental, Maturing, Stable, Retired, or Static.
_Avoid_: Health, support tier

**Experimental**:
An early exploration focused on validating ideas. Breaking changes are likely, and maintenance commitments remain limited.
_Avoid_: Prototype

**Maturing**:
A useful, actively developed project moving toward stability. Compatibility matters, but changes may still break existing users.
_Avoid_: Beta

**Stable**:
A production-ready project with defined scope, predictable behavior, and ongoing bug and security maintenance. Major changes are rare and clearly communicated.
_Avoid_: Finished

**Retired**:
An inactive project for which Outskirts Labs plans no fixes, issue review, or releases.
_Avoid_: Deprecated

**Static**:
Reference, demonstration, research, or educational code intentionally published without ongoing updates.
_Avoid_: Retired, abandoned
