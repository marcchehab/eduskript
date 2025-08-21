Let's start implementing collaboration between teachers. To give each other permissions and collaborate on content, we first need to implement the concept of "Collaborators". So teachers can befriend each other. In the dashboard, add a page "Collaborate", where teachers can search for each other. They can then send each other a collaboration request. If they accept a collaboration request, they are collaborators. After implementing this, we'll move on to how teachers can give each other permissions to skripts and collections.

So teachers now may add collaborators, great. We'll not implement the permissions to collections and skripts.

Let me start by clarifying the concepts of collections and skripts. Collections are bundles of skripts and a single skript may be part of multiple collections. We'll implement the UI components to do that later. Generally teachers will collaborate on skripts, but they may also collaboratively edit collections. So both skripts and collections may have more than one author.

It's probably best to implement permissions with a n-m relation between skripts/collections and teachers, instead of "authorId" column in skripts/collections.

We need the following permissions to be possible: 

Collections & Skripts:
    One or multiple authors who can edit. Authors can add & remove who is an author. They can also remove themselves, if they're not the last author.
    Zero or multiple other collaborators who can view the contents (and later also use the skript without being able to modify it or copy it - we'll implement that further down the line)
    If a teacher can view a collection, they can also view all skripts within it (without an explicit permission on those skripts)

A teacher sees whatever skripts or collections they're at least allowed to view on their dashboard. And they can 